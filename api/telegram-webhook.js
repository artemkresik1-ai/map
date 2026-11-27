const { timingSafeEqual } = require("node:crypto");

const TELEGRAM_API_TIMEOUT_MS = 8000;
const SITE_URL = "https://map-three-brown.vercel.app/";
const START_MESSAGE = [
  "👋 Вітаємо в Арт.Радарі!",
  "",
  "Це неофіційна інформаційна мапа. Дані надходять із відкритих джерел, можуть запізнюватися або бути неповними.",
  "",
  "Сайт не є офіційним засобом оповіщення і не замінює сигнали повітряної тривоги чи повідомлення державних органів. Під час тривоги прямуйте до укриття та дотримуйтеся офіційних інструкцій."
].join("\n");

function authorizedHeaderMatches(request, expectedSecret) {
  const provided = request.headers?.["x-telegram-bot-api-secret-token"];
  if (typeof provided !== "string") return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expectedSecret);
  return providedBuffer.length === expectedBuffer.length
    && timingSafeEqual(providedBuffer, expectedBuffer);
}

function parseUpdate(body) {
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body && typeof body === "object" ? body : null;
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !webhookSecret || !/^[A-Za-z0-9_-]{32,256}$/.test(webhookSecret)) {
    return response.status(503).json({
      ok: false,
      error: "Telegram webhook is not configured"
    });
  }

  if (!authorizedHeaderMatches(request, webhookSecret)) {
    return response.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const update = parseUpdate(request.body);
  if (!update || typeof update !== "object") {
    return response.status(400).json({ ok: false, error: "Invalid update" });
  }

  const message = update.message;
  const text = typeof message?.text === "string" ? message.text.trim() : "";
  const command = text.match(/^\/(start|help)(?:@[a-zA-Z0-9_]+)?(?:\s|$)/i);
  const chatId = message?.chat?.id;

  if (!command || !Number.isSafeInteger(chatId)) {
    return response.status(200).json({ ok: true });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_API_TIMEOUT_MS);
  try {
    const telegramResponse = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: START_MESSAGE,
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [{ text: "Відкрити Арт.Радар", url: SITE_URL }],
            [{ text: "Джерело даних: alerts.in.ua", url: "https://alerts.in.ua/" }]
          ]
        }
      }),
      signal: controller.signal
    });

    if (!telegramResponse.ok) {
      console.error(`Telegram sendMessage returned HTTP ${telegramResponse.status}`);
      return response.status(502).json({ ok: false, error: "Telegram API error" });
    }

    const result = await telegramResponse.json();
    if (!result?.ok) {
      console.error("Telegram sendMessage returned an unsuccessful response");
      return response.status(502).json({ ok: false, error: "Telegram API error" });
    }

    return response.status(200).json({ ok: true });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    console.error("Telegram sendMessage failed:", timedOut ? "timeout" : error?.name);
    return response.status(timedOut ? 504 : 502).json({
      ok: false,
      error: timedOut ? "Telegram API request timed out" : "Telegram API unavailable"
    });
  } finally {
    clearTimeout(timeout);
  }
};
