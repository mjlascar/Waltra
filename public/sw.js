/**
 * Service worker de Waltra.
 *
 * Objetivo: que la app abra sin conexion. Los datos ya viven en IndexedDB, asi
 * que offline se puede consultar y cargar movimientos; lo unico que no anda es
 * traer precios nuevos.
 *
 * Reglas:
 * - /api/*  -> siempre red. Un precio viejo servido desde cache seria mentir.
 * - navegaciones -> red primero, cache como respaldo.
 * - estaticos -> cache primero (el hash del nombre ya invalida).
 */
const VERSION = "waltra-v1";
const SHELL = ["/", "/cartera", "/movimientos", "/insights", "/ajustes", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit ?? caches.match("/"))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
