interface WakeLockContext {
  wakeLock?: WakeLockSentinel | null;
}

window.gapFlowUtils = {
  /**
   * Formatiert einen Zeitstempel in eine deutsche Uhrzeit im Format HH:MM.
   * @param {number} timestamp - Millisekunden-Zeitstempel.
   * @returns {string} Formatierte Uhrzeit.
   */
  formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  },

  /**
   * Fordert den Screen Wake Lock an, um das Abdunkeln des Bildschirms zu verhindern.
   * @param {WakeLockContext} ctx - Kontext mit WakeLockSentinel Referenz.
   * @returns {Promise<void>}
   */
  async requestWakeLock(ctx: WakeLockContext): Promise<void> {
    if (!ctx || !('wakeLock' in navigator)) return;
    if (ctx.wakeLock) return;
    try {
      ctx.wakeLock = await navigator.wakeLock.request('screen');

      ctx.wakeLock.addEventListener('release', () => {
        ctx.wakeLock = null;
        if (document.visibilityState === 'visible') {
          this.requestWakeLock(ctx);
        }
      });
    } catch (err) {
      const error = err as Error;
      console.warn(`[WakeLock] Blockiert oder fehlgeschlagen: ${error.message}`);
    }
  },

  /**
   * Koppelt die automatische Erneuerung des Wake Locks an die Sichtbarkeit des Browser-Tabs.
   * @param {WakeLockContext} ctx - Kontext mit WakeLockSentinel Referenz.
   * @returns {void}
   */
  bindAutoWakeLock(ctx: WakeLockContext): void {
    this.requestWakeLock(ctx);
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
        await this.requestWakeLock(ctx);
      }
    });
  },

  readAndDecodeFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('Keine Datei übergeben'));

      const reader = new FileReader();
      reader.onload = (e: ProgressEvent<FileReader>) => {
        const arrayBuffer = e.target?.result;
        if (!arrayBuffer || typeof arrayBuffer === 'string') {
          return reject(new Error('Ungültiger Dateiinhalt'));
        }
        let text = '';
        try {
          const decoder = new TextDecoder('utf-8', { fatal: true });
          text = decoder.decode(arrayBuffer as ArrayBuffer);
        } catch (err) {
          const decoder = new TextDecoder('windows-1252');
          text = decoder.decode(arrayBuffer as ArrayBuffer);
        }
        resolve(text);
      };
      reader.onerror = (err) => reject(err);
      reader.readAsArrayBuffer(file);
    });
  },

  parseCSVFile(
    file: File,
    completeCallback: (data: unknown[][]) => void,
    errorCallback?: (err: Error) => void
  ): void {
    if (!file) return;
    this.readAndDecodeFile(file)
      .then((text: string) => {
        if (typeof window.Papa === 'undefined') {
          throw new Error('Bibliotheks-Konflikt: PapaParse ist auf dieser Seite nicht geladen.');
        }
        window.Papa.parse(text, {
          skipEmptyLines: 'greedy',
          header: false,
          complete: (results: { data: unknown[][] }) => {
            completeCallback(results.data);
          },
          error: (err: Error) => {
            if (errorCallback) errorCallback(err);
          },
        });
      })
      .catch((err: Error) => {
        if (errorCallback) errorCallback(err);
      });
  },

  async downloadFileFromResponse(response: Response, filename: string): Promise<boolean> {
    try {
      if (!response.ok) return false;
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      return true;
    } catch (e) {
      console.error('[GAP-Flow-Utils] Fehler beim Dateidownload:', e);
      return false;
    }
  },
};
