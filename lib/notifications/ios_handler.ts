import webpush from 'web-push';
import { NotificationPayload } from '../types';
import { formatNotificationActions } from './android_handler';

/**
 * iOS / Apple Safari PWA-spezifischer Push-Notification Handler.
 * Berücksichtigt APNs-Einschränkungen (max 4KB Payload, Entfernen nicht unterstützter Arrays).
 */
export interface IosPushOptions extends webpush.RequestOptions {
  TTL: number;
  headers: {
    'apns-priority': '10' | '5';
  };
}

/**
 * Bereitet die iOS-spezifischen APNs-Web-Push-Optionen vor.
 * @returns {IosPushOptions} Web-Push-Optionen.
 */
export function getIosPushOptions(): IosPushOptions {
  return {
    TTL: 5400,
    headers: {
      'apns-priority': '10',
    },
  };
}

/**
 * Formatiert den Push-Payload speziell für iOS Safari PWAs.
 * @param {NotificationPayload} basePayload - Das generische Payload.
 * @returns {Record<string, unknown>} Das iOS-bereinigte Payload.
 */
export function formatIosPayload(basePayload: NotificationPayload): Record<string, unknown> {
  const cleanPayload: Record<string, unknown> = {
    title: String(basePayload.title || 'GAP-Flow Benachrichtigung'),
    body: String(basePayload.body || ''),
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: String(basePayload.tag || basePayload.type || 'gap-flow-ios'),
    timestamp: basePayload.timestamp ? Number(basePayload.timestamp) : Date.now(),
    data: {
      url: String(basePayload.url || '/pruefer.html'),
      os: 'ios',
      ...(basePayload.data || {}),
    },
  };

  const actions = formatNotificationActions(basePayload);
  if (actions) {
    cleanPayload.actions = actions;
  }

  return cleanPayload;
}
