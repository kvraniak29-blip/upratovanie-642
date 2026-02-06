"use strict";

const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");

admin.initializeApp();
const db = admin.firestore();

const DEFAULT_APP_URL = "https://bd-642-26-upratovanie-d2851.web.app/";
const TEST_KEY = process.env.BD642_TEST_KEY || "";

function nowTs() {
  return admin.firestore.Timestamp.fromDate(new Date());
}

async function nacitajTokenyRodiny(rodina) {
  if (!rodina) return [];
  const snap = await db.collection(`rodiny/${rodina}/fcm_tokens`).get();
  const tokens = [];
  snap.forEach((d) => {
    const t = d.get("token") || d.id;
    if (t && typeof t === "string") tokens.push(t);
  });
  return Array.from(new Set(tokens));
}

async function posliMulticast(rodina, payload) {
  const tokens = await nacitajTokenyRodiny(rodina);
  if (!tokens.length) {
    return { ok: false, dovod: "ZIADNE_TOKENY", successCount: 0, failureCount: 0, failedTokens: [] };
  }

  const message = {
    tokens,
    notification: payload.notification || undefined,
    data: payload.data || undefined,
    webpush: payload.webpush || undefined,
    android: payload.android || undefined
  };

  const resp = await admin.messaging().sendEachForMulticast(message);

  const failedTokens = [];
  resp.responses.forEach((r, i) => { if (!r.success) failedTokens.push(tokens[i]); });

  return { ok: resp.successCount > 0, successCount: resp.successCount, failureCount: resp.failureCount, failedTokens };
}

// (1) Scheduler – každých 5 minút: spracuje notifications_queue
exports.sendScheduledNotifications = onSchedule("every 5 minutes", async () => {
  const teraz = new Date();
  const snap = await db.collection("notifications_queue").orderBy("plannedAt", "asc").limit(100).get();

  const batch = db.batch();
  let processed = 0;

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    if (data.sentAt) continue;

    const plannedAt = data.plannedAt ? data.plannedAt.toDate() : null;
    if (!plannedAt) continue;
    if (plannedAt.getTime() > teraz.getTime()) continue;

    const rodina = (data.rodina || "").toString().trim();
    const title = (data.title || "Upozornenie").toString();
    const body  = (data.body  || "").toString();
    const url   = (data.url   || DEFAULT_APP_URL).toString();

    const payload = {
      notification: { title, body },
      data: {
        kind: (data.type || "schedule").toString(),
        rodina,
        url,
        ...(data.data && typeof data.data === "object" ? data.data : {})
      },
      webpush: { fcmOptions: { link: url } }
    };

    const result = await posliMulticast(rodina, payload);

    batch.update(doc.ref, { sentAt: nowTs(), sendResult: result, processedAt: nowTs() });

    processed++;
    if (processed >= 50) break;
  }

  if (processed > 0) await batch.commit();
  return null;
});

// (2) Chat trigger – rodiny/{rodina}/chat/{msgId}
exports.sendChatNotification = onDocumentCreated("rodiny/{rodina}/chat/{msgId}", async (event) => {
  const rodina = event.params.rodina;
  const doc = event.data;
  if (!doc) return;

  const m = doc.data() || {};
  const text = (m.text || "").toString();
  const from = (m.from || "Niekto").toString();
  const url = `${DEFAULT_APP_URL}#chat`;

  const payload = {
    notification: { title: `Chat – ${rodina}`, body: text ? `${from}: ${text}` : `${from} poslal správu` },
    data: { kind: "chat", rodina, url },
    webpush: { fcmOptions: { link: url } }
  };

  const result = await posliMulticast(rodina, payload);

  await doc.ref.set({ push: { sentAt: nowTs(), result } }, { merge: true });
  return null;
});

// (3) Test push – HTTPS endpoint (bez loginu) s kľúčom
exports.sendTestNotification = onRequest(async (req, res) => {
  try {
    const k = (req.query.k || "").toString();
    if (!TEST_KEY || k !== TEST_KEY) {
      res.status(403).json({ ok: false, dovod: "ZLY_KLUC" });
      return;
    }

    const rodina = (req.query.rodina || "").toString().trim();
    if (!rodina) {
      res.status(400).json({ ok: false, dovod: "CHYBA_RODINA" });
      return;
    }

    const title = (req.query.title || "BD642 – test").toString();
    const body  = (req.query.body  || "Test push z backendu.").toString();
    const url   = (req.query.url   || DEFAULT_APP_URL).toString();

    const payload = {
      notification: { title, body },
      data: { kind: "test", rodina, url },
      webpush: { fcmOptions: { link: url } }
    };

    const result = await posliMulticast(rodina, payload);
    res.status(200).json({ ok: true, rodina, result });
  } catch (e) {
    res.status(500).json({ ok: false, chyba: String(e && e.message ? e.message : e) });
  }
});
