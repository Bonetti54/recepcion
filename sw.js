/*
 * Service worker de la app "Recepción de Mercadería".
 *
 * Reglas (simples a propósito):
 *  - La pantalla (index.html) se pide SIEMPRE primero a la red: si hay señal,
 *    se ve la versión más nueva. Solo si no hay señal se usa la copia guardada.
 *  - Íconos, manifiesto y la biblioteca de la cámara se sirven de la copia
 *    guardada (no cambian seguido) y se actualizan en segundo plano.
 *  - NUNCA se guardan ni se responden desde la caché las llamadas al servidor
 *    (Apps Script). Así no hay datos viejos ni operaciones repetidas.
 *  - Los datos del teléfono (catálogo, borradores) NO están acá: están en el
 *    almacenamiento de la app y una actualización no los toca.
 *
 * Para publicar un cambio de este archivo, subir el número de CACHE.
 */
var CACHE = 'recepcion-v2.2.1';
var PANTALLA = './index.html';
var ESTATICOS = ['./manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];
var LIBRERIAS = ['https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll([PANTALLA].concat(ESTATICOS)).then(function () {
        // La biblioteca externa es opcional: si falla, la app igual funciona (con lector y búsqueda).
        return Promise.all(LIBRERIAS.map(function (u) { return c.add(u).catch(function () {}); }));
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('recepcion-') === 0 && k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function esServidor(url) {
  return url.hostname.indexOf('script.google') >= 0 || url.hostname.indexOf('googleusercontent') >= 0 ||
         url.pathname.slice(-5) === '/exec';
}

/** Red primero, con tiempo límite; si falla, la copia guardada. */
function redPrimero(req, cacheKey) {
  return new Promise(function (resolve) {
    var listo = false;
    var timer = setTimeout(function () {
      caches.match(cacheKey).then(function (r) { if (!listo && r) { listo = true; resolve(r); } });
    }, 6000);
    fetch(req).then(function (resp) {
      clearTimeout(timer);
      if (resp && resp.ok) {
        var copia = resp.clone();
        caches.open(CACHE).then(function (c) { c.put(cacheKey, copia); });
      }
      if (!listo) { listo = true; resolve(resp); }
    }).catch(function () {
      clearTimeout(timer);
      caches.match(cacheKey).then(function (r) {
        if (!listo) { listo = true; resolve(r || new Response('Sin conexión y sin copia guardada de la app.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })); }
      });
    });
  });
}

/** Copia guardada primero; se actualiza en segundo plano. */
function copiaPrimero(req) {
  return caches.match(req).then(function (r) {
    var red = fetch(req).then(function (resp) {
      if (resp && (resp.ok || resp.type === 'opaque')) {
        var copia = resp.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copia); });
      }
      return resp;
    }).catch(function () { return r; });
    return r || red;
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;                 // POST al servidor: nunca se toca
  var url = new URL(req.url);
  if (esServidor(url)) return;                       // servidor: siempre directo a la red
  var mismoOrigen = url.origin === self.location.origin;
  if (req.mode === 'navigate' || (mismoOrigen && /\/(index\.html)?$/.test(url.pathname))) {
    event.respondWith(redPrimero(req, PANTALLA));
    return;
  }
  if (mismoOrigen && ESTATICOS.some(function (e) { return url.pathname.slice(-e.length + 1) === e.slice(1); })) {
    event.respondWith(copiaPrimero(req));
    return;
  }
  if (LIBRERIAS.indexOf(req.url) >= 0) {
    event.respondWith(copiaPrimero(req));
    return;
  }
  // Todo lo demás (fuentes, etc.): comportamiento normal del navegador.
});
