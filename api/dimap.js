const DIMAP_API_URL = "https://radar.povitryanavarta.pp.ua/api/dimap";
const REQUEST_TIMEOUT_MS = 7500;

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const upstream = await fetch(DIMAP_API_URL, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });

    if (!upstream.ok) {
      console.error(`DIMAP upstream returned HTTP ${upstream.status}`);
      return response.status(502).json({ ok: false, error: "DIMAP upstream error" });
    }

    const data = await upstream.json();
    if (!data?.ok || !Array.isArray(data.targets)) {
      console.error("DIMAP upstream returned an invalid response");
      return response.status(502).json({ ok: false, error: "Invalid DIMAP response" });
    }

    response.setHeader("Cache-Control", "no-store, max-age=0");
    return response.status(200).json(data);
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    console.error("DIMAP proxy request failed:", error);
    return response.status(timedOut ? 504 : 502).json({
      ok: false,
      error: timedOut ? "DIMAP request timed out" : "DIMAP upstream unavailable"
    });
  } finally {
    clearTimeout(timeout);
  }
};
