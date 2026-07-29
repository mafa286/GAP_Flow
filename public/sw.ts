// Version Tracker: public/sw.ts (GAP-Flow v1.1.9)

/* eslint-disable no-restricted-globals */
'use strict';

// Globale Typ-Anpassung für den Service Worker im DOM-Kontext
const sw = self as any;

const CACHE_NAME = 'gap-flow-v5';
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

/**
 * Push-Event: Empfängt eingehende Web-Push-Benachrichtigungen vom Server/Push-Dienst.
 * @param {any} event - Das native PushEvent der Service Worker API.
 * @returns {void}
 */
sw.addEventListener('push', (event: any) => {
  if (!event.data) return;

  try {
    const payload = event.data.json();
    const title = payload.title || 'GAP-Flow Benachrichtigung';
    const options = {
      body: payload.body || '',
      icon: payload.icon || '/manifest.json',
      badge: payload.badge || '/manifest.json',
      tag: payload.tag || 'gap-flow-notification',
      renotify: payload.renotify !== false,
      vibrate: payload.vibrate || [200, 100, 200],
      data: payload.data || {},
      actions: payload.actions || [],
    };

    event.waitUntil(sw.registration.showNotification(title, options));
  } catch (err) {
    console.error('[SW] Fehler beim Verarbeiten der Push-Nachricht:', err);
  }
});

/**
 * NotificationClick-Event: Reagiert auf Interaktionen mit Benachrichtigungen und Aktions-Buttons.
 * @param {any} event - Das native NotificationEvent der Service Worker API.
 * @returns {void}
 */
sw.addEventListener('notificationclick', (event: any) => {
  const notification = event.notification;
  const action = event.action;
  const data = notification.data || {};

  notification.close();

  if (action === 'deactivate') {
    event.waitUntil(
      sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList: any[]) => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.navigate('/pruefer.html#settings-notifications');
            return client.focus();
          }
        }
        if (sw.clients.openWindow) {
          return sw.clients.openWindow('/pruefer.html#settings-notifications');
        }
        return null;
      })
    );
    return;
  }

  if (action === 'end_pause') {
    const token = data.token;
    event.waitUntil(
      fetch('/api/examiner/pause', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token || '',
        },
        body: JSON.stringify({ paused: false }),
      })
        .then(() => {
          return sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList: any[]) => {
            for (const client of clientList) {
              if ('focus' in client) return client.focus();
            }
            if (sw.clients.openWindow) return sw.clients.openWindow('/pruefer.html');
            return null;
          });
        })
        .catch((err: unknown) => {
          console.error('[SW] Fehler beim Beenden der Pause via Notification Action:', err);
        })
    );
    return;
  }

  if (action === 'call' && data.phoneNumber) {
    if (sw.clients.openWindow) {
      event.waitUntil(sw.clients.openWindow(`tel:${data.phoneNumber}`));
    }
    return;
  }

  const targetUrl = data.url || '/pruefer.html';
  event.waitUntil(
    sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList: any[]) => {
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      if (sw.clients.openWindow) {
        return sw.clients.openWindow(targetUrl);
      }
      return null;
    })
  );
});
