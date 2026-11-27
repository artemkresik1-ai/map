const ALERTS_URL = "https://ubilling.net.ua/aerialalerts/";
const REQUEST_TIMEOUT_MS = 8000;

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const upstream = await fetch(ALERTS_URL, {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (!upstream.ok) {
      console.error(`Air-alert upstream returned HTTP ${upstream.status}`);
      return response.status(502).json({ ok: false, error: "Air-alert upstream error" });
    }

    const data = await upstream.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      console.error("Air-alert upstream returned an invalid response");
      return response.status(502).json({ ok: false, error: "Invalid air-alert response" });
    }

    response.setHeader("Cache-Control", "public, max-age=0, s-maxage=30, stale-while-revalidate=30");
    return response.status(200).json(data);
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    console.error("Air-alert proxy request failed:", timedOut ? "timeout" : error?.name);
    return response.status(timedOut ? 504 : 502).json({
      ok: false,
      error: timedOut ? "Air-alert request timed out" : "Air-alert upstream unavailable"
    });
  } finally {
    clearTimeout(timeout);
  }
};
