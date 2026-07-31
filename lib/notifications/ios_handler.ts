// Version Tracker: lib/notifications/ios_handler.ts (GAP-Flow v1.0.0)

import webpush from 'web-push';
import { NotificationPayload } from '../types';

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
    title: basePayload.title,
    body: basePayload.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: basePayload.tag || 'gap-flow-ios',
    data: {
      url: '/pruefer.html',
      os: 'ios',
      ...(basePayload.data || {}),
    },
  };

  if (Array.isArray(basePayload.actions) && basePayload.actions.length > 0) {
    cleanPayload.actions = basePayload.actions.map((act) => ({
      action: act.action,
      title: act.title,
    }));
  }

  return cleanPayload;
}
