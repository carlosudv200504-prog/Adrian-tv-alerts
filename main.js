import { chromium } from "playwright";
import { PNG } from "pngjs";

const BOT = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;

const SYMBOLS = (process.env.SYMBOLS || "OANDA:EURUSD,OANDA:GBPUSD,OANDA:AUDUSD")
  .split(",").map(s => s.trim()).filter(Boolean);

const INTERVAL = process.env.TV_INTERVAL || "5";
const SCAN_EVERY_MS = Number(process.env.SCAN_EVERY_MS || 1200);
const COOLDOWN_MS = Number(process.env.COOLDOWN_MS || 60000);

const BLUE_RANGE = { rMin: 0, rMax: 90, gMin: 80, gMax: 180, bMin: 160, bMax: 255 };
const RED_RANGE  = { rMin: 160, rMax: 255, gMin: 0, gMax: 120, bMin: 0, bMax: 120 };

const THRESHOLD_PIXELS = Number(process.env.THRESHOLD_PIXELS || 800);

const ROI = {
  x: Number(process.env.ROI_X || 140),
  y: Number(process.env.ROI_Y || 160),
  width: Number(process.env.ROI_W || 950),
  height: Number(process.env.ROI_H || 520)
};

async function tg(text) {
  const url = `https://api.telegram.org/bot${BOT}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text, disable_web_page_preview: true })
  });
  if (!res.ok) throw new Error(await res.text());
}

function tvUrl(symbol, interval) {
  const sym = encodeURIComponent(symbol);
  return `https://www.tradingview.com/chart/?symbol=${sym}&interval=${interval}`;
}

function inRange(r, g, b, range) {
  return r>=range.rMin && r<=range.rMax && g>=range.gMin && g<=range.gMax && b>=range.bMin && b<=range.bMax;
}

function countColorPixels(png, range) {
  let count = 0;
  const d = png.data;
  for (let i=0; i<d.length; i+=4) {
    const r=d[i], g=d[i+1], b=d[i+2], a=d[i+3];
    if (a < 200) continue;
    if (inRange(r,g,b,range)) count++;
  }
  return count;
}

async function scanPage(page, symbol, lastAlert) {
  const buf = await page.screenshot({ clip: ROI });
  const png = PNG.sync.read(buf);

  const blue = countColorPixels(png, BLUE_RANGE);
  const red  = countColorPixels(png, RED_RANGE);

  const now = Date.now();
  const last = lastAlert.get(symbol) || 0;
  if (now - last < COOLDOWN_MS) return;

  let signal = null;
  if (blue >= THRESHOLD_PIXELS) signal = { color:"BLUE", action:"SELL", pixels:blue };
  if (red  >= THRESHOLD_PIXELS) signal = { color:"RED",  action:"BUY",  pixels:red  };

  if (signal) {
    lastAlert.set(symbol, now);
    await tg(`🚨 OB/WATERBLOCK DETECTADO\nPar: ${symbol}\nCor: ${signal.color} → ${signal.action}\nPixels: ${signal.pixels}\nTF: M${INTERVAL}\n${tvUrl(symbol, INTERVAL)}`);
  }
}

async function main() {
  if (!BOT || !CHAT) throw new Error("Missing TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID");

  await tg(`✅ Adrian TV Alerts iniciou.\nPares: ${SYMBOLS.join(", ")}\nTF: M${INTERVAL}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

  const pages = [];
  for (const symbol of SYMBOLS) {
    const page = await context.newPage();
    await page.goto(tvUrl(symbol, INTERVAL), { waitUntil: "domcontentloaded" });
    pages.push({ symbol, page });
  }

  const lastAlert = new Map();

  while (true) {
    for (const { symbol, page } of pages) {
      try { await scanPage(page, symbol, lastAlert); }
      catch (e) { console.error("scan error", symbol, e); }
    }
    await new Promise(r => setTimeout(r, SCAN_EVERY_MS));
  }
}

main().catch(async (e) => {
  console.error(e);
  try { await tg("❌ Adrian caiu: " + e.message); } catch {}
  process.exit(1);
});
