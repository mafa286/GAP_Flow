import webpush from 'web-push';
import { NotificationPayload } from '../types';

/**
 * Android-spezifischer Push-Notification Handler.
 * Optimiert Payloads und Web-Push-Header für Google FCM und Android Doze-Modus.
 */
export interface AndroidPushOptions extends webpush.RequestOptions {
  TTL: number;
  urgency: 'high' | 'normal' | 'low' | 'very-low';
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
    TTL: 5400,
    urgency: 'high',
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
  const cleanPayload: Record<string, unknown> = {
    title: String(basePayload.title || 'GAP-Flow Benachrichtigung'),
    body: String(basePayload.body || ''),
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: String(basePayload.tag || basePayload.type || 'gap-flow-android'),
    renotify: true,
    vibrate: Array.isArray(basePayload.vibrate)
      ? basePayload.vibrate.map((v) => Math.abs(parseInt(String(v), 10) || 100))
      : [300, 100, 300],
    data: {
      url: String(basePayload.url || '/pruefer.html'),
      os: 'android',
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
