const { timingSafeEqual } = require("node:crypto");

const WEBHOOK_URL = "https://map-three-brown.vercel.app/api/telegram-webhook";
const TELEGRAM_API_TIMEOUT_MS = 8000;

function parseBody(body) {
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body && typeof body === "object" ? body : null;
}

function secretMatches(provided, expected) {
  if (typeof provided !== "string") return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length
    && timingSafeEqual(providedBuffer, expectedBuffer);
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !/^[A-Za-z0-9_-]{32,256}$/.test(webhookSecret || "")) {
    return response.status(503).json({
      ok: false,
      error: "Add TELEGRAM_BOT_TOKEN and a valid TELEGRAM_WEBHOOK_SECRET in Vercel"
    });
  }

  const body = parseBody(request.body);
  if (!secretMatches(body?.secret, webhookSecret)) {
    return response.status(401).json({ ok: false, error: "Secret does not match Vercel configuration" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_API_TIMEOUT_MS);
  try {
    const telegramResponse = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: WEBHOOK_URL,
        secret_token: webhookSecret,
        allowed_updates: ["message"]
      }),
      signal: controller.signal
    });

    const result = await telegramResponse.json();
    if (!telegramResponse.ok || !result?.ok) {
      console.error(`Telegram setWebhook failed with HTTP ${telegramResponse.status}`);
      return response.status(502).json({
        ok: false,
        error: "Telegram could not register the webhook. Check the bot token."
      });
    }

    return response.status(200).json({ ok: true, message: "Webhook registered" });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    console.error("Telegram setWebhook request failed:", timedOut ? "timeout" : error?.name);
    return response.status(timedOut ? 504 : 502).json({
      ok: false,
      error: timedOut ? "Telegram API request timed out" : "Telegram API unavailable"
    });
  } finally {
    clearTimeout(timeout);
  }
};
