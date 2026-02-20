const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const REGION = "europe-west1";
const TZ = "Europe/Bratislava";

/**
 * BD642_SECRET sa berie zo Secret Manageru:
 * firebase functions:secrets:set BD642_SECRET
 * a do funkcie sa "pripojí" cez runWith({ secrets: [...] }).
 */
function getSecretEnv() {
  return String(process.env.BD642_SECRET || "").trim();
}

/**
 * Preferuj secret v HTTP hlavičke (X-Secret), až potom v body.secret.
 */
function getProvidedSecret(req) {
  // express headers sú case-insensitive, ale necháme to explicitne
  const h = String(req.get("x-secret") || req.get("X-Secret") || "").trim();
  const b = String((req.body && req.body.secret) || "").trim();
  return h || b;
}

/**
 * Jednoduché CORS (ak budeš volať z prehliadača).
 * Ak to voláš len zo skriptu/servera, stále nevadí.
 */
function applyCors(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, X-Secret");
  res.set("Access-Control-Max-Age", "3600");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return false;
}

/**
 * HTTP endpoint: naplánuje push
 * POST JSON:
 * {
 *   "secret": "...",                 (alebo X-Secret header)
 *   "family": "Cuchorovci",
 *   "sendAtIso": "2026-01-05T18:00:00.000Z",
 *   "title": "BD 642 – upozornenie",
 *   "body": "Si na rade tento týždeň.",
 *   "url": "./?bd642=rem"
 * }
 */
exports.queueReminder = functions
  .runWith({ secrets: ["BD642_SECRET"] })
  .region(REGION)
  .https.onRequest(async (req, res) => {
    try {
      if (applyCors(req, res)) return;

      if (req.method !== "POST") return res.status(405).send("POST only");

      const SECRET = getSecretEnv();
      if (!SECRET) return res.status(500).send("server not configured (missing BD642_SECRET)");

      const provided = getProvidedSecret(req);
      if (provided !== SECRET) return res.status(403).send("bad secret");

      const b = req.body || {};

      const family = String(b.family || "").trim();
      const sendAtIso = String(b.sendAtIso || "").trim();

      if (!family) return res.status(400).send("missing family");
      if (!sendAtIso) return res.status(400).send("missing sendAtIso");

      const sendAt = new Date(sendAtIso);
      if (isNaN(sendAt.getTime())) return res.status(400).send("invalid sendAtIso");

      const doc = {
        family,
        sendAt: admin.firestore.Timestamp.fromDate(sendAt),
        title: String(b.title || "BD 642 – upozornenie"),
        body: String(b.body || ""),
        url: String(b.url || "./"),
        sent: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      const ref = await admin.firestore().collection("scheduled_push").add(doc);

      // Bez logovania secretu – OK
      console.log("queueReminder scheduled", { id: ref.id, family, sendAtIso });

      return res.status(200).json({ ok: true, id: ref.id });
    } catch (e) {
      console.error("queueReminder error:", e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

/**
 * Scheduler: každú 1 minútu pošle splatné notifikácie
 * - nájde unsent, sendAt <= now
 * - zistí tokeny z: rodiny/{family}/fcm_tokens/*
 * - pošle multicast
 * - invalid tokeny vymaže
 * - označí doc sent=true
 */
exports.tick = functions
  .region(REGION)
  .pubsub.schedule("every 1 minutes")
  .timeZone(TZ)
  .onRun(async () => {
    const now = admin.firestore.Timestamp.now();
    const db = admin.firestore();

    // Pozn.: Ak Firestore vypýta index (sent + sendAt), vytvor ho podľa linku v logu.
    const snap = await db
      .collection("scheduled_push")
      .where("sent", "==", false)
      .where("sendAt", "<=", now)
      .limit(50)
      .get();

    if (snap.empty) return null;

    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const family = String(data.family || "").trim();

      if (!family) {
        await doc.ref.set({ sent: true, sentError: "missing family" }, { merge: true });
        continue;
      }

      const tokSnap = await db.collection("rodiny").doc(family).collection("fcm_tokens").get();
      const tokDocs = tokSnap.docs;

      // token môže byť v d.data().token alebo ako doc.id
      const tokens = tokDocs
        .map((d) => String((d.data() || {}).token || d.id))
        .map((t) => t.trim())
        .filter(Boolean);

      if (!tokens.length) {
        await doc.ref.set({ sent: true, sentError: "no tokens" }, { merge: true });
        continue;
      }

      const title = String(data.title || "BD 642 – upozornenie");
      const body = String(data.body || "");
      const url = String(data.url || "./");

      // Multicast (lepší výkon + detailné výsledky)
      const multicast = {
        tokens,
        notification: { title, body },
        data: { url, ts: new Date().toISOString() },
        webpush: {
          // Admin SDK používa fcmOptions (camelCase)
          fcmOptions: { link: url },
          headers: { Urgency: "high" },
        },
      };

      let resp;
      try {
        resp = await admin.messaging().sendEachForMulticast(multicast);
      } catch (e) {
        await doc.ref.set(
          { sent: true, sentError: "messaging_error", sentErrorDetail: String(e?.message || e) },
          { merge: true }
        );
        continue;
      }

      const results = resp.responses.map((r, i) => ({
        tokenTail: tokens[i].slice(-10),
        ok: !!r.success,
        err: r.success ? null : String(r.error?.message || r.error),
        code: r.success ? null : String(r.error?.code || ""),
      }));

      // Vymaž neplatné tokeny
      const invalidCodes = new Set([
        "messaging/registration-token-not-registered",
        "messaging/invalid-registration-token",
      ]);

      const deletions = [];
      resp.responses.forEach((r, i) => {
        const code = String(r.error?.code || "");
        if (!r.success && invalidCodes.has(code) && tokDocs[i]) {
          deletions.push(tokDocs[i].ref.delete());
        }
      });

      if (deletions.length) await Promise.allSettled(deletions);

      await doc.ref.set(
        {
          sent: true,
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
          sendResults: results,
          successCount: resp.successCount,
          failureCount: resp.failureCount,
        },
        { merge: true }
      );
    }

    return null;
  });