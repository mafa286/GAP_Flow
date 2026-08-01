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
    if ('Notification' in window) {
      try {
        const res = await Notification.requestPermission();
        ctx.notificationPermissionStatus = res;
        if (res === 'granted') {
          await this.subscribeToWebPush(ctx);
        }
        return res;
      } catch (e) {
        console.error('Fehler beim Anfragen der Benachrichtigungsberechtigung:', e);
      }
    }
    return 'unsupported';
  },

  /**
   * Registriert das Smartphone beim W3C Web Push Service.
   * @param {PushSubscriptionContext} ctx - Der Kontext der Prüfer-Komponente.
   * @param {boolean} [forceFresh=false] - Zwingt die Erneuerung der Subscription.
   * @returns {Promise<void>}
   */
  async subscribeToWebPush(ctx: PushSubscriptionContext, forceFresh = false): Promise<void> {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !ctx.token) return;

    try {
      const keyRes = await fetch('/api/push/vapid-public-key');
      if (!keyRes.ok) return;
      const { publicKey } = await keyRes.json();
      if (!publicKey) return;

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();

      const urlBase64ToUint8Array = (base64String: string) => {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
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
      } else {
        console.warn('[PWA Web Push] Server-Registrierung fehlgeschlagen, Status:', subRes.status);
      }
    } catch (e) {
      console.error('[PWA Web Push] Registrierungsfehler:', e);
    }
  },

  /**
   * Führt einen lokalen Test des Server-Pushs aus.
   * @param {PushSubscriptionContext} ctx - Der Kontext der Prüfer-Komponente.
   * @returns {Promise<void>}
   */
  async sendServerTestNotification(ctx: PushSubscriptionContext): Promise<void> {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) {
      alert('Service Worker oder Benachrichtigungen werden auf diesem Gerät nicht unterstützt.');
      return;
    }

    if (Notification.permission !== 'granted') {
      alert(`Hinweis: Benachrichtigungserlaubnis steht auf "${Notification.permission}". Bitte tippe zuerst auf "🔔 Benachrichtigungen anfragen"!`);
      return;
    }

    if (!ctx.token) {
      alert('Kein Token vorhanden. Bitte scanne zuerst den QR-Code deiner Station.');
      return;
    }

    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg || !reg.active) {
        alert('Kein aktiver Service Worker geladen. Bitte lade die Seite einmal neu.');
        return;
      }

      await this.subscribeToWebPush(ctx, true);

      const response = await ctx._postApi('test-push');

      if (response.ok) {
        alert('Befehl ausgeführt: Subscription wurde frisch bei Google FCM registriert und Test-Push wurde gesendet! Prüfe jetzt das Server-Log.');
      } else {
        const errData = (await response.json().catch(() => ({}))) as { error?: string };
        alert(`Server-Rückmeldung: ${errData.error || response.statusText}`);
      }
    } catch (e) {
      const error = e as Error;
      alert(`Fehler beim Senden des Server Web Push Tests: ${error.message}`);
    }
  },
};
