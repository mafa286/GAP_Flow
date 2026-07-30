// Version Tracker: lib/notifications/core.ts (GAP-Flow v1.0.0)

import webpush from 'web-push';
import { NotificationPayload } from '../types';
import * as dbModule from '../db';
import * as androidHandler from './android_handler';
import * as iosHandler from './ios_handler';
import * as windowsHandler from './windows_handler';

let vapidPublicKey = '';
let vapidPrivateKey = '';

/**
 * Generiert und speichert ein neues VAPID-Schlüsselpaar.
 * @param {any} db - SQLite Instanz oder null.
 * @param {() => void} resolve - Promise Resolver.
 */
function generateAndSaveVapidKeys(db: any, resolve: () => void): void {
  const keys = webpush.generateVAPIDKeys();
  vapidPublicKey = keys.publicKey;
  vapidPrivateKey = keys.privateKey;
  if (db && !dbModule.getUseJsonFallback()) {
    db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('vapid_public_key', ?)", [vapidPublicKey]);
    db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('vapid_private_key', ?)", [vapidPrivateKey]);
  }
  webpush.setVapidDetails('mailto:leitstand@gap-flow.de', vapidPublicKey, vapidPrivateKey);
  console.log('[WebPush Core] Neues VAPID Schlüsselpaar generiert und aktiviert.');
  resolve();
}

/**
 * Initialisiert die VAPID Schlüssel aus der Datenbank oder erstellt neue.
 * @returns {Promise<void>}
 */
export function initVapidKeys(): Promise<void> {
  return new Promise((resolve) => {
    const db = dbModule.getDb();
    if (db && !dbModule.getUseJsonFallback()) {
      db.get("SELECT value FROM meta WHERE key = 'vapid_public_key'", [], (err, rowPublic: any) => {
        if (!err && rowPublic && rowPublic.value) {
          vapidPublicKey = rowPublic.value;
          db.get("SELECT value FROM meta WHERE key = 'vapid_private_key'", [], (err2, rowPrivate: any) => {
            if (!err2 && rowPrivate && rowPrivate.value) {
              vapidPrivateKey = rowPrivate.value;
              webpush.setVapidDetails('mailto:leitstand@gap-flow.de', vapidPublicKey, vapidPrivateKey);
              console.log('[WebPush Core] VAPID Schlüsselpaar aus Datenbank geladen.');
              resolve();
            } else {
              generateAndSaveVapidKeys(db, resolve);
            }
          });
        } else {
          generateAndSaveVapidKeys(db, resolve);
        }
      });
    } else {
      generateAndSaveVapidKeys(null, resolve);
    }
  });
}

/**
 * Liefert den aktiven VAPID Public Key für den Client.
 * @returns {string} Der öffentliche VAPID Schlüssel.
 */
export function getVapidPublicKey(): string {
  return vapidPublicKey;
}

/**
 * Sendet eine W3C Web Push Benachrichtigung an passende Abonnenten, geroutet über das jeweilige Betriebssystem-Modul.
 * @param {string} roleTarget - Ziel-Rolle ('examiner', 'admin', 'all').
 * @param {NotificationPayload} basePayload - Das Grund-Payload der Benachrichtigung.
 * @param {string} [targetSubId] - Optionale Ziel-Unterstation ID (z.B. '1.1').
 * @returns {Promise<void>}
 */
export async function sendNotification(
  roleTarget: string,
  basePayload: NotificationPayload,
  targetSubId?: string
): Promise<void> {
  const db = dbModule.getDb();
  if (!db || dbModule.getUseJsonFallback() || !vapidPublicKey) return;

  let query = "SELECT * FROM push_subscriptions WHERE 1=1";
  const params: unknown[] = [];

  if (roleTarget && roleTarget !== 'all') {
    query += " AND role = ?";
    params.push(roleTarget);
  }

  if (targetSubId) {
    query += " AND (targetId = ? OR targetId = '' OR targetId IS NULL)";
    params.push(targetSubId);
  }

  db.all(query, params, (err, rows: any[]) => {
    if (err) {
      console.error('[WebPush SQL Fehler]', err.message);
      return;
    }
    if (!rows || rows.length === 0) return;

    // Deduplizierung: Pro Unterstation (targetId) nur die neueste Subscription verwenden,
    // um simultane Doppel-Pushs an dasselbe Gerät zu verhindern
    const subMap = new Map<string, any>();
    rows.forEach((r) => {
      const key = r.targetId || r.endpoint;
      if (!subMap.has(key) || (r.timestamp && r.timestamp > subMap.get(key).timestamp)) {
        subMap.set(key, r);
      }
    });
    const deduplicatedRows = Array.from(subMap.values());

    const pushTitle = String(basePayload.title || 'Benachrichtigung');
    const pushType = String(basePayload.tag || basePayload.type || 'standard');
    console.log(`[WebPush Core Start] Sende "${pushTitle}" (Typ: ${pushType}) an ${deduplicatedRows.length} Abonnenten (Ziel-Rolle: ${roleTarget}, Ziel-Station: ${targetSubId || 'alle'})`);

    deduplicatedRows.forEach((r) => {
      const sub = {
        endpoint: r.endpoint,
        keys: {
          p256dh: r.keys_p256dh,
          auth: r.keys_auth,
        },
      };

      const os = (r.os || 'android').toLowerCase();
      let pushOptions: webpush.RequestOptions;
      let finalPayload: Record<string, unknown>;

      if (os === 'ios') {
        pushOptions = iosHandler.getIosPushOptions();
        finalPayload = iosHandler.formatIosPayload(basePayload);
      } else if (os === 'windows') {
        pushOptions = windowsHandler.getWindowsPushOptions();
        finalPayload = windowsHandler.formatWindowsPayload(basePayload);
      } else {
        // Standard Android Handler
        pushOptions = androidHandler.getAndroidPushOptions();
        finalPayload = androidHandler.formatAndroidPayload(basePayload);
      }

      let endpointDomain = 'unbekannt';
      try {
        if (r.endpoint) {
          endpointDomain = new URL(r.endpoint).hostname;
        }
      } catch (_) {}

      const payloadStr = JSON.stringify(finalPayload);

      webpush
        .sendNotification(sub, payloadStr, pushOptions)
        .then((res) => {
          console.log(
            `[WebPush Erfolgreich] ID: ${r.id} | OS: ${os.toUpperCase()} | Station: ${r.targetId || 'alle'} | Rolle: ${r.role} | Host: ${endpointDomain} | Status: ${res.statusCode} | Titel: "${pushTitle}"`
          );
        })
        .catch((pushErr) => {
          console.error(
            `[WebPush Fehler] ID: ${r.id} | OS: ${os.toUpperCase()} | Station: ${r.targetId || 'alle'} | Rolle: ${r.role} | Host: ${endpointDomain} | HTTP ${pushErr.statusCode || 'N/A'}: ${pushErr.message}`
          );
          if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
            console.log(`[WebPush Bereinigung] Entferne abgelaufene Subscription ${r.id} aus der Datenbank.`);
            db.run('DELETE FROM push_subscriptions WHERE id = ?', [r.id]);
          }
        });
    });
  });
}
