// Version Tracker: lib/notifications/windows_handler.ts (GAP-Flow v1.0.0)

import webpush from 'web-push';
import { NotificationPayload } from '../types';

/**
 * Windows / Desktop Browser-spezifischer Push-Notification Handler.
 */
export interface WindowsPushOptions extends webpush.RequestOptions {
  TTL: number;
}

/**
 * Bereitet die Windows-spezifischen Web-Push-Optionen vor.
 * @returns {WindowsPushOptions} Web-Push-Optionen.
 */
export function getWindowsPushOptions(): WindowsPushOptions {
  return {
    TTL: 86400,
  };
}

/**
 * Formatiert den Push-Payload speziell für Windows Desktop Browser.
 * @param {NotificationPayload} basePayload - Das generische Payload.
 * @returns {Record<string, unknown>} Das Windows-optimierte Payload.
 */
export function formatWindowsPayload(basePayload: NotificationPayload): Record<string, unknown> {
  return {
    ...basePayload,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: {
      url: '/pruefer.html',
      os: 'windows',
      ...(basePayload.data || {}),
    },
  };
}
