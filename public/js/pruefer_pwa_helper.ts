interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface PwaContext {
  deferredPrompt?: BeforeInstallPromptEvent | null;
  isInstallPromptReady?: boolean;
  isCompiling?: boolean;
  appInstalledSuccessfully?: boolean;
  _pwaFailSafeTimer?: ReturnType<typeof setTimeout> | number | null;
}

window.prueferPwaHelper = {
  /**
   * Prüft, ob das zugreifende Gerät ein iOS-Gerät (iPhone, iPad) ist.
   * @returns {boolean} True, wenn iOS erkannt wurde.
   */
  isIOS(): boolean {
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
  },

  /**
   * Löst den nativen Android PWA-Installationsdialog aus.
   * @param {PwaContext} ctx - Kontextobjekt der PWA-Steuerung.
   * @returns {void}
   */
  triggerAndroidInstallPrompt(ctx: PwaContext): void {
    if (ctx.deferredPrompt) {
      ctx.deferredPrompt.prompt();
      ctx.deferredPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
          console.log('[PWA] Benutzer hat die Installation bestätigt');
        }
        ctx.deferredPrompt = null;
        ctx.isInstallPromptReady = false;
      });
    }
  },

  /**
   * Initialisiert das Tracking für erfolgreiche App-Installationen.
   * @param {PwaContext} ctx - Kontextobjekt der PWA-Steuerung.
   * @returns {void}
   */
  setupInstallTracking(ctx: PwaContext): void {
    window.addEventListener('appinstalled', () => {
      if (!ctx.isCompiling && !ctx.appInstalledSuccessfully) {
        ctx.isCompiling = true;
        ctx.isInstallPromptReady = false;

        ctx._pwaFailSafeTimer = setTimeout(() => {
          if (ctx.isCompiling) {
            ctx.isCompiling = false;
            ctx.appInstalledSuccessfully = true;
            localStorage.setItem('pwa_installed_and_opened', 'true');
          }
        }, 20000);
      } else if (ctx.isCompiling) {
        if (ctx._pwaFailSafeTimer) {
          clearTimeout(ctx._pwaFailSafeTimer as number);
          ctx._pwaFailSafeTimer = null;
        }
        ctx.isCompiling = false;
        ctx.appInstalledSuccessfully = true;
        localStorage.setItem('pwa_installed_and_opened', 'true');
      }
    });

    if ('getInstalledRelatedApps' in navigator && typeof navigator.getInstalledRelatedApps === 'function') {
      navigator.getInstalledRelatedApps()
        .then((relatedApps) => {
          if (relatedApps && relatedApps.length > 0) {
            ctx.appInstalledSuccessfully = true;
            ctx.isInstallPromptReady = false;
          }
        })
        .catch((err: Error) => console.warn('[PWA] Fehler bei getInstalledRelatedApps:', err));
    }
  },
};
