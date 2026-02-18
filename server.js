import express from "express";

const app = express();
app.use(express.json({ limit: "1mb" }));

const BOT = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
const SECRET = process.env.TV_WEBHOOK_SECRET || ""; // opcional

async function sendTelegram(text) {
  if (!BOT || !CHAT) throw new Error("Missing TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID");

  const url = `https://api.telegram.org/bot${BOT}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT,
      text,
      disable_web_page_preview: true
    })
  });

  if (!res.ok) throw new Error(await res.text());
}

// healthcheck
app.get("/", (_req, res) => res.status(200).send("ok"));

// webhook do TradingView
app.post("/tv", async (req, res) => {
  try {
    // segurança simples (opcional)
    if (SECRET) {
      const token = req.query.token || req.headers["x-tv-token"];
      if (token !== SECRET) return res.status(401).send("unauthorized");
    }

    const body = req.body || {};
    const pair = body.pair || body.symbol || "UNKNOWN";
    const color = body.color || body.side || body.action || "SIGNAL";
    const tf = body.tf || body.timeframe || "M5";
    const msg = body.message || "";

    const text =
      `🚨 WATERBLOCK/OB DETECTADO\n` +
      `Par: ${pair}\n` +
      `TF: ${tf}\n` +
      `Sinal: ${color}\n` +
      (msg ? `Info: ${msg}\n` : "");

    await sendTelegram(text);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    try { await sendTelegram("❌ Erro no webhook: " + e.message); } catch {}
    return res.status(500).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log("listening on", PORT);
  try {
    await sendTelegram("✅ Adrian TV Alerts online. Webhook pronto.");
  } catch (e) {
    console.error("telegram failed:", e.message);
  }
});
