const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const REGION = "europe-west1";
const TZ = "Europe/Bratislava";
const SECRET = "BD642_CHANGE_ME_123";

/**
 * Firestore:
 *   scheduled_push/{docId}:
 *     sendAt (Timestamp)  - kedy poslať
 *     family (string)     - rodina (napr. "Cuchorovci")
 *     title (string)
 *     body  (string)
 *     url   (string)
 *     sent  (bool)
 *     createdAt (Timestamp)
 */

/**
 * HTTP endpoint: naplánuje push
 * POST JSON:
 * {
 *   "secret": "....",
 *   "family": "Cuchorovci",
 *   "sendAtIso": "2026-01-05T18:00:00.000Z",
 *   "title": "BD 642 – upozornenie",
 *   "body": "Si na rade tento týždeň.",
 *   "url": "./?bd642=rem"
 * }
 */
exports.queueReminder = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    try {
      if (req.method !== "POST") return res.status(405).send("POST only");

      const b = req.body || {};
      if (b.secret !== SECRET) return res.status(403).send("bad secret");

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
        body:  String(b.body  || ""),
        url:   String(b.url   || "./"),
        sent: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };

      const ref = await admin.firestore().collection("scheduled_push").add(doc);
      return res.status(200).json({ ok: true, id: ref.id });
    } catch (e) {
      console.error("queueReminder error:", e);
      return res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  });

/**
 * Scheduler: každú 1 minútu pošle splatné notifikácie
 * - nájde unsent, sendAt <= now
 * - zistí tokeny z: rodiny/{family}/fcm_tokens/*
 * - pošle každému tokenu webpush s linkom
 * - označí doc sent=true
 */
exports.tick = functions
  .region(REGION)
  .pubsub.schedule("every 1 minutes")
  .timeZone(TZ)
  .onRun(async () => {
    const now = admin.firestore.Timestamp.now();
    const db = admin.firestore();

    const snap = await db.collection("scheduled_push")
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

      // tokeny rodiny
      const tokSnap = await db.collection("rodiny").doc(family).collection("fcm_tokens").get();
      const tokens = tokSnap.docs.map(d => String((d.data()||{}).token || d.id)).filter(Boolean);

      if (!tokens.length) {
        await doc.ref.set({ sent: true, sentError: "no tokens" }, { merge: true });
        continue;
      }

      const title = String(data.title || "BD 642 – upozornenie");
      const body  = String(data.body  || "");
      const url   = String(data.url   || "./");

      // pošli na všetky tokeny
      const messageBase = {
        notification: { title, body },
        data: { url, ts: new Date().toISOString() },
        webpush: {
          fcm_options: { link: url },
          headers: { Urgency: "high" }
        }
      };

      const results = [];
      for (const t of tokens) {
        try {
          const r = await admin.messaging().send({ token: t, ...messageBase });
          results.push({ tokenTail: t.slice(-10), ok: true, name: r });
        } catch (e) {
          results.push({ tokenTail: t.slice(-10), ok: false, err: String(e && e.message ? e.message : e) });
        }
      }

      await doc.ref.set({
        sent: true,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        sendResults: results
      }, { merge: true });
    }

    return null;
  });
