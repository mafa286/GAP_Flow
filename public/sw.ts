/* eslint-disable no-restricted-globals */
'use strict';

// Globale Typ-Anpassung für den Service Worker im DOM-Kontext
const sw = self as any;

const SW_VERSION = '1.3.0';
const CACHE_NAME = 'gap-flow-v1.3.0';
const ASSETS_TO_CACHE: string[] = [
  '/pruefer.html',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json',
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
 * Message-Event: Beantwortet Versionsanfragen der PWA-Clientansicht.
 */
sw.addEventListener('message', (event: any) => {
  if (event.data && event.data.type === 'GET_VERSION') {
    const response = {
      type: 'SW_VERSION_RESPONSE',
      version: SW_VERSION,
      cacheName: CACHE_NAME,
    };
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage(response);
    } else if (event.source && event.source.postMessage) {
      event.source.postMessage(response);
    }
  }
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

  const isJsRequest = event.request.url.includes('/js/') || event.request.url.endsWith('.js');

  if (isHtmlRequest || isJsRequest) {
    // Network-First Strategie für HTML & JS: Holt online immer die neuste Datei direkt vom Server
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
    // Cache-First Strategie für statische Assets (Bilder, Icons)
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
 * Garantiert Chrome-Android-Konformität (kein generischer Fallback-Text).
 * @param {any} event - Das native PushEvent der Service Worker API.
 * @returns {void}
 */
sw.addEventListener('push', (event: any) => {
  let payload: any = {};
  if (event && event.data) {
    try {
      payload = event.data.json();
    } catch (_) {
      try {
        payload = { title: 'GAP-Flow Benachrichtigung', body: event.data.text() };
      } catch (_) {
        payload = { title: 'GAP-Flow Benachrichtigung', body: 'Neue Benachrichtigung aus dem Prüfungsleitstand.' };
      }
    }
  }

  console.log('[SW Push Event]', payload);

  const origin = self.location ? self.location.origin : '';
  const title = (payload && payload.title) ? String(payload.title) : 'GAP-Flow Benachrichtigung';
  const body = (payload && payload.body) ? String(payload.body) : 'Neue Benachrichtigung aus dem Prüfungsleitstand.';

  const options: any = {
    body,
    icon: `${origin}/icon-192.png`,
    badge: `${origin}/icon-192.png`,
    tag: (payload && (payload.tag || payload.type)) ? String(payload.tag || payload.type) : 'gap-flow-notification',
    data: {
      url: (payload && payload.url) ? String(payload.url) : '/pruefer.html',
    },
  };

  if (Array.isArray(payload?.vibrate) && payload.vibrate.length > 0) {
    options.vibrate = payload.vibrate.map((v: any) => Math.abs(parseInt(String(v), 10) || 100));
  }

  if (Array.isArray(payload?.actions) && payload.actions.length > 0) {
        options.actions = payload.actions
          .filter((act: any) => act && act.action && act.title)
          .map((act: any) => ({
            action: String(act.action),
            title: String(act.title),
          }));
      }

      // In-App-Signal an alle geöffneten PWA-Fenster senden (Vordergrund-Feedback)
      sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList: any[]) => {
        for (const client of clientList) {
          if ('postMessage' in client) {
            client.postMessage({ type: 'PUSH_RECEIVED', payload });
          }
        }
      });

      const pushPromise = sw.registration.showNotification(title, options)
        .catch((err: unknown) => {
          console.error('[SW showNotification Error]', err);
          return sw.registration.showNotification('GAP-Flow Benachrichtigung', {
            body: 'Neue Benachrichtigung aus dem Prüfungsleitstand.',
            icon: `${origin}/icon-192.png`,
            badge: `${origin}/icon-192.png`,
            tag: 'gap-flow-fallback',
            data: { url: '/pruefer.html' },
          });
        });

      event.waitUntil(pushPromise);
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

  const rawUrl = data.url || '/pruefer.html';
  event.waitUntil(
    sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList: any[]) => {
      for (const client of clientList) {
        if (client.url.includes('pruefer.html') && 'focus' in client) {
          return client.focus();
        }
      }
      if (sw.clients.openWindow) {
        return sw.clients.openWindow(rawUrl);
      }
      return null;
    })
  );
});
