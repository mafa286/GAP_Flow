// Version Tracker: public/sw.ts (GAP-Flow v1.1.6)

/* eslint-disable no-restricted-globals */
'use strict';

// Globale Typ-Anpassung für den Service Worker im DOM-Kontext
const sw = self as any;

const CACHE_NAME = 'gap-flow-pruefer-v3';
const ASSETS_TO_CACHE: string[] = [
  '/pruefer.html',
  '/js/theme_config.js',
  '/js/audio_engine.js',
  '/js/gap_flow_utils.js',
  '/js/pruefer_pwa_helper.js',
  '/js/pruefer_core.js',
];

/**
 * Install-Event: Cacht die definierten Anwendungsdateien für den Offline-Betrieb.
 * @param {any} event - Das native Service Worker Install-Event.
 * @returns {void}
 */
sw.addEventListener('install', (event: any) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .then(() => sw.skipWaiting())
  );
});

/**
 * Activate-Event: Bereinigt alte Cache-Versionen im Browser.
 * @param {any} event - Das native Service Worker Activate-Event.
 * @returns {void}
 */
sw.addEventListener('activate', (event: any) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames.map((cache) => {
        if (cache !== CACHE_NAME) {
          return caches.delete(cache);
        }
        return null;
      })
    )).then(() => sw.clients.claim())
  );
});

/**
 * Fetch-Event: Network-First für HTML-Seiten (sofortige Updates), Cache-First für Offline-Assets.
 * @param {any} event - Das abgefangene HTTP-Anfrage-Event.
 * @returns {void}
 */
sw.addEventListener('fetch', (event: any) => {
  // Websockets, Server-Events und REST-API-Routen unberührt direkt an den Server durchlassen
  if (event.request.url.includes('/socket.io/') || event.request.url.includes('/api/')) {
    return;
  }

  const isHtmlRequest =
    event.request.mode === 'navigate' ||
    (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html'));

  if (isHtmlRequest) {
    // Network-First Strategie für HTML: Holt online immer die neuste HTML-Datei vom Server, weicht im Funkloch auf Cache aus
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            return caches.match('/pruefer.html');
          });
        })
    );
  } else {
    // Cache-First Strategie für statische Assets (JS, CSS, Bilder)
    event.respondWith(
      caches.match(event.request).then((response) => {
        if (response) {
          return response;
        }
        return fetch(event.request).then((networkResponse) => {
          if (event.request.method === 'GET' && networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        });
      })
    );
  }
});