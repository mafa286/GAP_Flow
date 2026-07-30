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
          return caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
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
        caches.match(event.request, { ignoreSearch: true }).then((response) => {
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
 * Sendet Fern-Diagnosedaten des Service Workers an das Server-Protokoll.
 */
async function reportSwDebugLog(logData: Record<string, unknown>): Promise<void> {
  try {
    await fetch('/api/sw-debug-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        swVersion: SW_VERSION,
        userAgent: self.navigator ? self.navigator.userAgent : 'unbekannt',
        ...logData,
      }),
    });
  } catch (e) {
    console.warn('[SW Remote Debug Report Fehler]', e);
  }
}

/**
 * Push-Event: Empfängt eingehende Web-Push-Benachrichtigungen vom Server/Push-Dienst
 * und protokolliert jeden einzelnen Ausführungsschritt für die Fern-Diagnose.
 * @param {any} event - Das native PushEvent der Service Worker API.
 * @returns {void}
 */
sw.addEventListener('push', (event: any) => {
  const startTime = Date.now();
  const debugInfo: Record<string, unknown> = {
    hasData: !!(event && event.data),
    rawText: null,
    parsedJson: null,
    parseError: null,
    optionsUsed: null,
    steps: [],
    showNotificationError: null,
    fallbackTriggered: false,
  };

  (debugInfo.steps as string[]).push('1. Push Event empfangen');

  let payload: any = {};
  if (event && event.data) {
    try {
      debugInfo.rawText = event.data.text();
      (debugInfo.steps as string[]).push('2. Raw-Text gelesen');
    } catch (e: any) {
      debugInfo.rawTextError = e.message;
    }

    try {
      payload = event.data.json();
      debugInfo.parsedJson = payload;
      (debugInfo.steps as string[]).push('3. JSON erfolgreich geparst');
    } catch (e: any) {
      debugInfo.parseError = e.message;
      (debugInfo.steps as string[]).push(`3. JSON-Parse-Fehler: ${e.message}`);
      try {
        payload = { title: 'GAP-Flow Benachrichtigung', body: event.data.text() };
      } catch (_) {
        payload = { title: 'GAP-Flow Benachrichtigung', body: 'Neue Benachrichtigung aus dem Prüfungsleitstand.' };
      }
    }
  } else {
    (debugInfo.steps as string[]).push('2. Keine event.data vorhanden!');
  }

  const origin = self.location ? self.location.origin : '';
  const title = (payload && payload.title) ? String(payload.title) : 'GAP-Flow Benachrichtigung';
  const body = (payload && payload.body) ? String(payload.body) : 'Neue Benachrichtigung aus dem Prüfungsleitstand.';

  const options: any = {
    body,
    icon: `${origin}/icon-192.png`,
    badge: `${origin}/icon-192.png`,
    tag: (payload && (payload.tag || payload.type)) ? String(payload.tag || payload.type) : 'gap-flow-notification',
    renotify: true,
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

  debugInfo.titleUsed = title;
  debugInfo.optionsUsed = options;
  (debugInfo.steps as string[]).push('4. Notification-Options vorbereitet');

  const pushExecution = (async () => {
    // 1. In-App-Signal an alle geöffneten PWA-Fenster senden
    try {
      const clientList = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        if ('postMessage' in client) {
          client.postMessage({ type: 'PUSH_RECEIVED', payload, debugInfo });
        }
      }
      (debugInfo.steps as string[]).push(`5. Client-PostMessage gesendet an ${clientList.length} Fenster`);
    } catch (e: any) {
      (debugInfo.steps as string[]).push(`5. Client-PostMessage Fehler: ${e.message}`);
    }

    // 2. Betriebssystem-Benachrichtigung rendern und Fehler exakt aufzeichnen
    try {
      await sw.registration.showNotification(title, options);
      (debugInfo.steps as string[]).push('6. showNotification ERFOLGREICH ausgeführt!');
    } catch (err1: any) {
      debugInfo.showNotificationError = {
        name: err1 ? err1.name : 'UnknownError',
        message: err1 ? err1.message : String(err1),
        stack: err1 ? err1.stack : null,
      };
      (debugInfo.steps as string[]).push(`6. showNotification FEHLER: ${err1 ? err1.name : 'Err'} - ${err1 ? err1.message : String(err1)}`);

      try {
        debugInfo.fallbackTriggered = true;
        const safeOptions: any = {
          body: options.body || '',
          icon: `${origin}/icon-192.png`,
          badge: `${origin}/icon-192.png`,
          data: options.data || { url: '/pruefer.html' },
        };
        await sw.registration.showNotification(title, safeOptions);
        (debugInfo.steps as string[]).push('7. Fallback-Notification ERFOLGREICH!');
      } catch (err2: any) {
        debugInfo.fallbackError = {
          name: err2 ? err2.name : 'UnknownError',
          message: err2 ? err2.message : String(err2),
          stack: err2 ? err2.stack : null,
        };
        (debugInfo.steps as string[]).push(`7. Fallback-Notification FEHLER: ${err2 ? err2.name : 'Err'} - ${err2 ? err2.message : String(err2)}`);
      }
    }

    debugInfo.durationMs = Date.now() - startTime;

    // Remote-Log an den Server senden
    await reportSwDebugLog(debugInfo);
  })();

  event.waitUntil(pushExecution);
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
