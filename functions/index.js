const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const REGION = "europe-west1";
const TZ = "Europe/Bratislava";

async function tokenExistsForFamily(family, token) {
  const db = admin.firestore();
  const ref = db.collection("rodiny").doc(family).collection("fcm_tokens").doc(token);
  const snap = await ref.get();
  return snap.exists;
}

const ALLOWED_FAMILIES = new Set(["Cuchorovci", "Markusekovci", "Jarosovci", "Vraniak"]);

function safeStr(x, maxLen) {
  const s = String(x || "");
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function parseIsoOrNull(iso) {
  const d = new Date(String(iso || ""));
  return isNaN(d.getTime()) ? null : d;
}

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
 * Jednoduché CORS (ak budeš volať zo skriptu/servera).
 */
function applyCorsAny(req, res) {
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

const ALLOWED_ORIGINS = new Set([
  "https://bd-642-26-upratovanie-d2851.web.app",
  "https://bd-642-26-upratovanie-d2851.firebaseapp.com",
  "http://localhost:5000",
  "http://localhost:8080",
  "http://localhost:5173",
]);

function applyCorsAllowlist(req, res) {
  const origin = String(req.get("origin") || "").trim();
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  } else {
    // bez Origin (skripty) alebo neznámy origin → neotvárame CORS
    res.set("Access-Control-Allow-Origin", "null");
  }

  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Max-Age", "3600");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return false;
}

/**
 * HTTP endpoint: naplánuje push (ADMIN/SCRIPT)
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
      if (applyCorsAny(req, res)) return;

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

      console.log("queueReminder scheduled", { id: ref.id, family, sendAtIso });

      return res.status(200).json({ ok: true, id: ref.id });
    } catch (e) {
      console.error("queueReminder error:", e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

/**
 * HTTP endpoint (PUBLIC z aplikácie): naplánuje push bez secretu.
 * Ochrana:
 * - CORS allowlist (len naše hosting domény)
 * - kontrola family v allowliste
 * - kontrola, že token existuje v: rodiny/{family}/fcm_tokens/{token}
 * - clientKey je deterministický (umožní update/cancel)
 *
 * POST JSON:
 * {
 *   "family": "Cuchorovci",
 *   "token": "<FCM token>",
 *   "clientKey": "bd642-one-...",
 *   "sendAtIso": "2026-01-05T18:00:00.000Z",
 *   "title": "...",
 *   "body": "...",
 *   "url": "./"
 * }
 */
exports.queueReminderPublic = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    try {
      if (applyCorsAllowlist(req, res)) return;
      if (req.method !== "POST") return res.status(405).send("POST only");

      const b = req.body || {};
      const family = String(b.family || "").trim();
      const token = String(b.token || "").trim();
      const clientKey = String(b.clientKey || "").trim();
      const sendAtIso = String(b.sendAtIso || "").trim();

      if (!family) return res.status(400).send("missing family");
      if (!ALLOWED_FAMILIES.has(family)) return res.status(400).send("bad family");
      if (!token) return res.status(400).send("missing token");
      if (!clientKey) return res.status(400).send("missing clientKey");
      if (!sendAtIso) return res.status(400).send("missing sendAtIso");

      const sendAt = parseIsoOrNull(sendAtIso);
      if (!sendAt) return res.status(400).send("invalid sendAtIso");

      const now = Date.now();
      const ms = sendAt.getTime() - now;
      // dovolíme plánovať od -5min do +365 dní
      if (ms < -5 * 60 * 1000) return res.status(400).send("sendAt in past");
      if (ms > 365 * 24 * 3600 * 1000) return res.status(400).send("sendAt too far");

      const okTok = await tokenExistsForFamily(family, token);
      if (!okTok) return res.status(403).send("token not registered for family");

      const doc = {
        family,
        sendAt: admin.firestore.Timestamp.fromDate(sendAt),
        title: safeStr(b.title || "BD 642 – upozornenie", 120),
        body: safeStr(b.body || "", 500),
        url: safeStr(b.url || "./", 500),
        clientKey,
        canceled: false,
        sent: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await admin.firestore().collection("scheduled_push").doc(clientKey).set(doc, { merge: true });

      console.log("queueReminderPublic scheduled", { clientKey, family, sendAtIso });

      return res.status(200).json({ ok: true, id: clientKey });
    } catch (e) {
      console.error("queueReminderPublic error:", e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

/**
 * HTTP endpoint (PUBLIC z aplikácie): zruší naplánovaný push (nastaví canceled=true).
 * POST JSON:
 * {
 *   "family": "Cuchorovci",
 *   "token": "<FCM token>",
 *   "clientKey": "bd642-one-..."
 * }
 */
exports.cancelReminderPublic = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    try {
      if (applyCorsAllowlist(req, res)) return;
      if (req.method !== "POST") return res.status(405).send("POST only");

      const b = req.body || {};
      const family = String(b.family || "").trim();
      const token = String(b.token || "").trim();
      const clientKey = String(b.clientKey || "").trim();

      if (!family) return res.status(400).send("missing family");
      if (!ALLOWED_FAMILIES.has(family)) return res.status(400).send("bad family");
      if (!token) return res.status(400).send("missing token");
      if (!clientKey) return res.status(400).send("missing clientKey");

      const okTok = await tokenExistsForFamily(family, token);
      if (!okTok) return res.status(403).send("token not registered for family");

      const ref = admin.firestore().collection("scheduled_push").doc(clientKey);
      const snap = await ref.get();
      if (!snap.exists) return res.status(200).json({ ok: true, id: clientKey, alreadyMissing: true });

      const data = snap.data() || {};
      if (String(data.family || "").trim() !== family) return res.status(403).send("family mismatch");

      await ref.set(
        {
          canceled: true,
          canceledAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      console.log("cancelReminderPublic canceled", { clientKey, family });

      return res.status(200).json({ ok: true, id: clientKey });
    } catch (e) {
      console.error("cancelReminderPublic error:", e);
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

      if (data && data.canceled) {
        await doc.ref.set({ sent: true, sentError: "canceled" }, { merge: true });
        continue;
      }

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