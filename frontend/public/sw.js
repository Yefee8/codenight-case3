const offlinePage = `<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>FraudCell çevrimdışı</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f7fafc;color:#1c1c27;font:16px system-ui"><main style="max-width:28rem;padding:2rem;text-align:center"><h1>Bağlantı yok</h1><p>FraudCell’e devam etmek için internet bağlantınızı kontrol edin.</p></main></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => new Response(offlinePage, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
  }
});
