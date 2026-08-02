/**
 * Modul für Web Push Subscriptions und Berechtigungen im Prüfer-Panel.
 */
export interface PushSubscriptionContext {
  token: string;
  subId: string;
  notificationPermissionStatus: string;
  isIOS(): boolean;
  _postApi(endpoint: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<Response>;
}

window.prueferPush = {
  /**
   * Überprüft den aktuellen Benachrichtigungsstatus des Browsers.
   * @returns {string} Erlaubnis-Status ('granted', 'denied', 'default', 'unsupported').
   */
  checkPermissions(): string {
    if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return 'insecure-context';
    }
    if ('Notification' in window) {
      return Notification.permission;
    }
    return 'unsupported';
  },

  /**
   * Fordert beim Benutzer die System-Benachrichtigungsberechtigung für PWA-Pushs an.
   * @param {PushSubscriptionContext} ctx - Der Kontext der Prüfer-Komponente.
   * @returns {Promise<string>} Aktualisierter Erlaubnis-Status.
   */
  async requestNotificationPermission(ctx: PushSubscriptionContext): Promise<string> {
    if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      alert('⚠️ Web Push erfordert eine sichere Verbindung (HTTPS) oder localhost! Über unverschlüsseltes HTTP blockieren moderne Browser Benachrichtigungen aus Sicherheitsgründen.');
      return 'insecure-context';
    }

    if (!('Notification' in window)) {
      alert('⚠️ Benachrichtigungen werden von diesem Browser oder Gerät nicht unterstützt.');
      return 'unsupported';
    }

    try {
      const res = await Notification.requestPermission();
      ctx.notificationPermissionStatus = res;

      if (res === 'granted') {
        const subSuccess = await this.subscribeToWebPush(ctx);
        if (subSuccess) {
          alert('✅ Benachrichtigungserlaubnis erteilt und Smartphone erfolgreich beim Push-Dienst registriert!');
        } else {
          alert('⚠️ Benachrichtigungserlaubnis erteilt, aber die Push-Registrierung auf dem Server schlug fehl. Bitte lade die Seite neu.');
        }
      } else if (res === 'denied') {
        alert('⛔ Benachrichtigungen wurden im Browser oder Betriebssystem blockiert. Bitte schalte Benachrichtigungen in den Browser- / Android-Einstellungen frei.');
      } else {
        alert(`Hinweis: Status der Benachrichtigungserlaubnis ist "${res}".`);
      }
      return res;
    } catch (e) {
      const error = e as Error;
      alert(`Fehler beim Anfragen der Benachrichtigungserlaubnis: ${error.message}`);
      return 'error';
    }
  },

  /**
   * Registriert das Smartphone beim W3C Web Push Service.
   * @param {PushSubscriptionContext} ctx - Der Kontext der Prüfer-Komponente.
   * @param {boolean} [forceFresh=false] - Zwingt die Erneuerung der Subscription.
   * @returns {Promise<void>}
   */
  async subscribeToWebPush(ctx: PushSubscriptionContext, forceFresh = false): Promise<boolean> {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !ctx.token) {
      console.warn('[PWA Web Push] Abbruch: ServiceWorker, PushManager oder Token fehlt.');
      return false;
    }

    try {
      const keyRes = await fetch('/api/push/vapid-public-key');
      if (!keyRes.ok) return false;
      const { publicKey } = await keyRes.json();
      if (!publicKey) return false;

      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        reg = await navigator.serviceWorker.register('/sw.js');
      }

      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Service Worker Aktivierungs-Timeout (5s)')), 5000)
        ),
      ]);

      let sub = await reg.pushManager.getSubscription();

      const urlBase64ToUint8Array = (base64String: string) => {
        const cleanBase64Str = String(base64String || '').trim();
        const padding = '='.repeat((4 - (cleanBase64Str.length % 4)) % 4);
        const base64 = (cleanBase64Str + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; i += 1) {
          outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
      };

      const newKeyBytes = urlBase64ToUint8Array(publicKey);

      if (sub && forceFresh) {
        console.log('[PWA Web Push] Erneuere Subscription erzwungen...');
        await sub.unsubscribe().catch(() => {});
        sub = null;
      } else if (sub) {
        const existingKey = sub.options.applicationServerKey;
        if (existingKey) {
          const existingKeyArray = new Uint8Array(existingKey);
          let match = existingKeyArray.length === newKeyBytes.length;
          if (match) {
            for (let i = 0; i < newKeyBytes.length; i += 1) {
              if (existingKeyArray[i] !== newKeyBytes[i]) {
                match = false;
                break;
              }
            }
          }
          if (!match) {
            console.log('[PWA Web Push] VAPID Key aktualisiert. Erneuere Push-Subscription...');
            await sub.unsubscribe().catch(() => {});
            sub = null;
          }
        }
      }

      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: newKeyBytes,
        });
      }

      const detectOs = (): string => {
        if (ctx.isIOS()) return 'ios';
        if (/Win/i.test(navigator.platform || '')) return 'windows';
        return 'android';
      };

      const subRes = await fetch('/api/examiner/push-subscription', {
        method: 'POST',
        headers: {
          Authorization: ctx.token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subscription: sub,
          role: 'examiner',
          targetId: ctx.subId,
          os: detectOs(),
        }),
      });
      if (subRes.ok) {
        console.log('[PWA Web Push] Erfolgreich beim W3C Push-Dienst registriert:', sub.endpoint);
        return true;
      } else {
        console.warn('[PWA Web Push] Server-Registrierung fehlgeschlagen, Status:', subRes.status);
        return false;
      }
    } catch (e) {
      console.error('[PWA Web Push] Registrierungsfehler:', e);
      return false;
    }
  },

  /**
   * Führt einen lokalen Test des Server-Pushs aus.
   * @param {PushSubscriptionContext} ctx - Der Kontext der Prüfer-Komponente.
   * @returns {Promise<void>}
   */
  async sendServerTestNotification(ctx: PushSubscriptionContext): Promise<void> {
    if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      alert('⚠️ Web Push erfordert HTTPS oder localhost! Über unverschlüsseltes HTTP blockieren Browser Benachrichtigungen.');
      return;
    }

    if (!('serviceWorker' in navigator) || !('Notification' in window)) {
      alert('⚠️ Service Worker oder Benachrichtigungen werden auf diesem Gerät nicht unterstützt.');
      return;
    }

    if (Notification.permission !== 'granted') {
      alert(`Hinweis: Benachrichtigungserlaubnis steht auf "${Notification.permission}". Bitte tippe zuerst auf "🔔 Benachrichtigungen anfragen"!`);
      return;
    }

    if (!ctx.token) {
      alert('⚠️ Kein Stationstoken vorhanden. Bitte scanne zuerst den QR-Code deiner Station!');
      return;
    }

    try {
      const subSuccess = await this.subscribeToWebPush(ctx, true);
      if (!subSuccess) {
        alert('⚠️ Push-Subscription konnte auf dem Server nicht erneuert werden. Prüfe das Server-Log oder die Netzwerkverbindung.');
        return;
      }

      const response = await ctx._postApi('test-push');

      if (response.ok) {
        alert('🚀 Echter Server-Push ausgelöst! Die Test-Benachrichtigung wurde über Google FCM an dein Smartphone gesendet.');
      } else {
        const errData = (await response.json().catch(() => ({}))) as { error?: string };
        alert(`Server-Rückmeldung (${response.status}): ${errData.error || response.statusText}`);
      }
    } catch (e) {
      const error = e as Error;
      alert(`Fehler beim Senden des Server Web Push Tests: ${error.message}`);
    }
  },
};
