// Version Tracker: lib/notifications/android_handler.ts (GAP-Flow v1.0.1)

import webpush from 'web-push';
import { NotificationPayload } from '../types';

/**
 * Android-spezifischer Push-Notification Handler.
 * Optimiert Payloads und Web-Push-Header für Google FCM und Android Doze-Modus.
 */
export interface AndroidPushOptions extends webpush.RequestOptions {
  TTL: number;
  headers: {
    Urgency: 'high' | 'normal' | 'low' | 'very-low';
  };
}

/**
 * Bereitet die Android-spezifischen Web-Push-Optionen vor (High Urgency für Doze Mode).
 * @returns {AndroidPushOptions} Web-Push-Optionen.
 */
export function getAndroidPushOptions(): AndroidPushOptions {
  return {
    TTL: 86400,
    headers: {
      Urgency: 'high',
    },
  };
}

/**
 * Formatiert den Push-Payload speziell für Android-Geräte (vibrate, actions, icons).
 * @param {NotificationPayload} basePayload - Das generische Payload.
 * @returns {Record<string, unknown>} Das Android-optimierte Payload.
 */
export function formatAndroidPayload(basePayload: NotificationPayload): Record<string, unknown> {
  return {
    title: String(basePayload.title || 'GAP-Flow Benachrichtigung'),
    body: String(basePayload.body || ''),
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: String(basePayload.tag || basePayload.type || 'gap-flow-android'),
    renotify: basePayload.renotify !== false,
    vibrate: Array.isArray(basePayload.vibrate)
      ? basePayload.vibrate.map((v) => Math.abs(parseInt(String(v), 10) || 100))
      : [300, 100, 300],
    data: {
      url: '/pruefer.html',
      os: 'android',
      ...(basePayload.data || {}),
    },
  };
}
