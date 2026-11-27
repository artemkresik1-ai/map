const CACHE_VERSION = "radar-shell-v6";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const SHELL_URLS = ["/", "/index.html", "/manifest.webmanifest", "/icons/app-icon.svg"];
const ALLOWED_CDN_HOSTS = new Set(["unpkg.com", "fonts.googleapis.com", "fonts.gstatic.com"]);

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => cache.addAll(SHELL_URLS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys
                .filter(key => key.startsWith("radar-shell-") && key !== STATIC_CACHE)
                .map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    const request = event.request;
    if (request.method !== "GET") return;
    const url = new URL(request.url);

    if (url.origin === self.location.origin) {
        if (url.pathname.startsWith("/api/")) return;
        if (request.mode === "navigate") {
            event.respondWith(fetch(request)
                .then(async response => {
                    if (response.ok) {
                        const cache = await caches.open(STATIC_CACHE);
                        await cache.put("/", response.clone());
                    }
                    return response;
                })
                .catch(async () => (await caches.match(request)) || caches.match("/")));
            return;
        }
        if (SHELL_URLS.includes(url.pathname)) {
            event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
        }
        return;
    }

    if (!ALLOWED_CDN_HOSTS.has(url.hostname)) return;
    const isFontStylesheet = url.hostname === "fonts.googleapis.com" && url.pathname.startsWith("/css");
    if (!isFontStylesheet && !/\.(?:css|js|woff2?)$/i.test(url.pathname)) return;
    event.respondWith(caches.open(STATIC_CACHE).then(async cache => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok || response.type === "opaque") {
            cache.put(request, response.clone());
        }
        return response;
    }));
});
