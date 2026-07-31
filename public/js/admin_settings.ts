// Version Tracker: public/js/admin_settings.ts (GAP-Flow v1.0.6)

/**
 * Schnittstelle für die Admin-Settings-Alpine-Komponente.
 */
interface CallbackItem {
  target: string;
  subId: string;
  examinerName: string;
  phoneNumber: string;
  timestamp: number;
}

interface PushStationItem {
  id: string;
  label: string;
  examiner: string;
  hasPushSub: boolean;
}

interface AdminSettingsComponent {
  phoneLeitstelleName: string;
  phoneLeitstelleNumber: string;
  phonePruefungsleitungName: string;
  phonePruefungsleitungNumber: string;
  broadcastText: string;
  incomingCallbacks: CallbackItem[];
  isSubmitting: boolean;
  password: string;
  showUpdateStatusModal: boolean;
  updateStep: string;
  updateErrorMessage: string;
  showServerLogModal: boolean;
  serverLogText: string;
  hasBuildError: boolean;
  isGeneratingRepomix: boolean;

  showCallbackModal: boolean;
  callbackType: 'leitstelle' | 'pruefungsleitung';
  selectedStationId: string;
  registeredStations: PushStationItem[];
  isSendingCallback: boolean;
  callbackAckReceived: boolean;
  callbackAckTimeout: ReturnType<typeof setTimeout> | null;
  callbackError: string;

  initSocket(): void;
  openCallbackModal(type: 'leitstelle' | 'pruefungsleitung'): Promise<void>;
  closeCallbackModal(): void;
  sendCallbackPush(): Promise<void>;
  saveSettings(): Promise<void>;
  sendLeitstelleCallback(): Promise<void>;
  sendPruefungsleitungCallback(): Promise<void>;
  sendBroadcastMessage(): Promise<void>;
  sendErgebnisbekanntgabe(): Promise<void>;
  dismissCallback(index: number): void;
  triggerSystemRestart(): Promise<void>;
  downloadRepomix(): Promise<void>;
  fetchServerLog(): Promise<void>;
  pollServerPing(): Promise<void>;
  getUpdateTitle(): string;
  getUpdateDescription(): string;
  reloadAfterUpdate(): void;
  connectSocket(callback: (state: Record<string, unknown>) => void): void;
}

window.adminPanel = function (): Record<string, unknown> {
  const coreConfig = {
    phoneLeitstelleName: '',
    phoneLeitstelleNumber: '',
    phonePruefungsleitungName: '',
    phonePruefungsleitungNumber: '',
    broadcastText: '',
    incomingCallbacks: [] as CallbackItem[],
    isSubmitting: false,
    showUpdateStatusModal: false,
    updateStep: '',
    updateErrorMessage: '',
    showServerLogModal: false,
    serverLogText: '',
    hasBuildError: false,
    isGeneratingRepomix: false,

    showCallbackModal: false,
    callbackType: 'leitstelle' as 'leitstelle' | 'pruefungsleitung',
    selectedStationId: 'all',
    registeredStations: [] as PushStationItem[],
    isSendingCallback: false,
    callbackAckReceived: false,
    callbackAckTimeout: null as ReturnType<typeof setTimeout> | null,
    callbackError: '',

    initSocket(): void {
      const self = this as unknown as AdminSettingsComponent;
      self.connectSocket((state: Record<string, unknown>) => {
        const settings = (state.settings || {}) as Record<string, string>;
        self.phoneLeitstelleName = settings.phoneLeitstelleName || '';
        self.phoneLeitstelleNumber = settings.phoneLeitstelleNumber || '';
        self.phonePruefungsleitungName = settings.phonePruefungsleitungName || '';
        self.phonePruefungsleitungNumber = settings.phonePruefungsleitungNumber || '';
      });

      if (window.adminSocket) {
        window.adminSocket.on('callbackRequested', (data: unknown) => {
          const item = data as CallbackItem;
          self.incomingCallbacks.unshift(item);
        });

        window.adminSocket.on('pushAckReceived', (data: unknown) => {
          const ack = data as { tag: string; subId: string; os: string; timestamp: number };
          if (self.isSendingCallback || self.showCallbackModal) {
            if (self.selectedStationId === 'all' || ack.subId === self.selectedStationId || !self.selectedStationId) {
              self.callbackAckReceived = true;
              self.isSendingCallback = false;
              if (self.callbackAckTimeout) {
                clearTimeout(self.callbackAckTimeout);
                self.callbackAckTimeout = null;
              }
            }
          }
        });
      }
    },

    /**
     * Öffnet das Modalfenster zur gezielten Auswahl einer Station für Rückrufanforderungen.
     * @param {'leitstelle' | 'pruefungsleitung'} type - Die anfordernde Stelle.
     * @returns {Promise<void>}
     */
    async openCallbackModal(type: 'leitstelle' | 'pruefungsleitung'): Promise<void> {
      const self = this as unknown as AdminSettingsComponent;
      self.callbackType = type;
      self.showCallbackModal = true;
      self.selectedStationId = 'all';
      self.isSendingCallback = false;
      self.callbackAckReceived = false;
      self.callbackError = '';
      if (self.callbackAckTimeout) {
        clearTimeout(self.callbackAckTimeout);
        self.callbackAckTimeout = null;
      }

      try {
        const response = await fetch('/api/admin/push-stations', {
          headers: { Authorization: self.password },
        });
        if (response.ok) {
          const data = (await response.json()) as { stations: PushStationItem[] };
          self.registeredStations = data.stations || [];

          const activeStation = self.registeredStations.find((s) => s.hasPushSub);
          if (activeStation) {
            self.selectedStationId = activeStation.id;
          } else if (self.registeredStations.length > 0) {
            self.selectedStationId = self.registeredStations[0].id;
          }
        }
      } catch (e) {
        console.error('Fehler beim Laden der registrierten Stationen:', e);
      }
    },

    /**
     * Schließt das Rückruf-Modalfenster und setzt den Zustand zurück.
     * @returns {void}
     */
    closeCallbackModal(): void {
      const self = this as unknown as AdminSettingsComponent;
      self.showCallbackModal = false;
      self.isSendingCallback = false;
      self.callbackAckReceived = false;
      self.callbackError = '';
      if (self.callbackAckTimeout) {
        clearTimeout(self.callbackAckTimeout);
        self.callbackAckTimeout = null;
      }
    },

    /**
     * Sendet die gezielte Rückruf-Anforderung an die gewählte Station.
     * @returns {Promise<void>}
     */
    async sendCallbackPush(): Promise<void> {
      const self = this as unknown as AdminSettingsComponent;
      if (self.isSendingCallback) return;

      self.isSendingCallback = true;
      self.callbackAckReceived = false;
      self.callbackError = '';

      const isLeitstelle = self.callbackType === 'leitstelle';
      const title = isLeitstelle ? '🚨 LEITSTELLE BITTET UM RÜCKRUF!' : '🚨 PRÜFUNGSLEITUNG BITTET UM RÜCKRUF!';
      const body = isLeitstelle
        ? 'Bitte wähle die Leitstelle über den Menü-Button.'
        : 'Bitte wähle die Prüfungsleitung über den Menü-Button.';
      const type = isLeitstelle ? 'callback_leitstelle' : 'callback_pruefungsleitung';

      try {
        const response = await fetch('/api/admin/notify', {
          method: 'POST',
          headers: { Authorization: self.password, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type,
            title,
            body,
            targetSubId: self.selectedStationId,
            vibrate: [500, 150, 500, 150, 500, 300, 1000],
          }),
        });

        if (!response.ok) {
          const errData = (await response.json().catch(() => ({}))) as { error?: string };
          self.callbackError = errData.error || `Fehler beim Senden (Status ${response.status})`;
          self.isSendingCallback = false;
          return;
        }

        self.callbackAckTimeout = setTimeout(() => {
          if (self.isSendingCallback && !self.callbackAckReceived) {
            self.isSendingCallback = false;
            if (self.selectedStationId === 'all') {
              self.callbackAckReceived = true;
            } else {
              self.callbackError = 'Anforderung an Server gesendet. Noch keine Empfangsbestätigung vom Gerät erhalten (evtl. offline oder im Standby).';
            }
          }
        }, 8000);
      } catch (e) {
        const error = e as Error;
        console.error(error);
        self.callbackError = `Netzwerk-Fehler: ${error.message}`;
        self.isSendingCallback = false;
      }
    },

    /**
     * Sendet den Aufruf "Rückruf Leitstelle" (öffnet Modalfenster).
     * @returns {Promise<void>}
     */
    async sendLeitstelleCallback(): Promise<void> {
      const self = this as unknown as AdminSettingsComponent;
      await self.openCallbackModal('leitstelle');
    },

    /**
     * Sendet den Aufruf "Rückruf Prüfungsleitung" (öffnet Modalfenster).
     * @returns {Promise<void>}
     */
    async sendPruefungsleitungCallback(): Promise<void> {
      const self = this as unknown as AdminSettingsComponent;
      await self.openCallbackModal('pruefungsleitung');
    },

    /**
     * Sendet den Aufruf "Rückruf Prüfungsleitung" an alle Prüfer-Smartphones im Gelände.
     */
    async sendPruefungsleitungCallback(): Promise<void> {
      const self = this as unknown as AdminSettingsComponent;
      if (!confirm('Soll ein dringender Rückrufwunsch der PRÜFUNGSLEITUNG an alle Prüfer gesendet werden?')) return;

      self.isSubmitting = true;
      try {
        const response = await fetch('/api/admin/notify', {
          method: 'POST',
          headers: { Authorization: self.password, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'callback_pruefungsleitung',
            title: '🚨 PRÜFUNGSLEITUNG BITTET UM RÜCKRUF!',
            body: 'Bitte wähle die Prüfungsleitung über den Menü-Button.',
            vibrate: [500, 150, 500, 150, 500, 300, 1000],
          }),
        });
        if (response.ok) {
          alert('Rückrufwunsch wurde erfolgreich gesendet.');
        } else {
          const errData = (await response.json().catch(() => ({}))) as { error?: string };
          alert(`Fehler beim Senden: ${errData.error || response.statusText} (Status ${response.status})`);
        }
      } catch (e) {
        console.error(e);
        alert('Netzwerk-Fehler beim Senden des Rückrufwunsches.');
      } finally {
        self.isSubmitting = false;
      }
    },

    /**
     * Sendet einen individuellen Rundruf-Text an alle Prüfer.
     */
    async sendBroadcastMessage(): Promise<void> {
      const self = this as unknown as AdminSettingsComponent;
      const text = self.broadcastText.trim();
      if (!text) return;

      self.isSubmitting = true;
      try {
        const response = await fetch('/api/admin/notify', {
          method: 'POST',
          headers: { Authorization: self.password, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'broadcast',
            title: '📢 Rundruf der Prüfungsleitung',
            body: text,
            vibrate: [300, 100, 300, 100, 300],
          }),
        });
        if (response.ok) {
          self.broadcastText = '';
          alert('Rundruf wurde erfolgreich gesendet.');
        } else {
          const errData = (await response.json().catch(() => ({}))) as { error?: string };
          alert(`Fehler beim Senden des Rundrufs: ${errData.error || response.statusText} (Status ${response.status})`);
        }
      } catch (e) {
        console.error(e);
        alert('Netzwerk-Fehler beim Senden des Rundrufs.');
      } finally {
        self.isSubmitting = false;
      }
    },

    /**
     * Sendet die Benachrichtigung zur Ergebnisbekanntgabe.
     */
    async sendErgebnisbekanntgabe(): Promise<void> {
      const self = this as unknown as AdminSettingsComponent;
      if (!confirm('Soll die Ergebnisbekanntgabe an alle Geräte ausgerufen werden?')) return;

      self.isSubmitting = true;
      try {
        const response = await fetch('/api/admin/notify', {
          method: 'POST',
          headers: { Authorization: self.password, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'result_announcement',
            title: '🏆 ERGEBNISBEKANNTGABE!',
            body: 'Alle Ergebnisse sind ausgewertet! Bitte alle in den Sammelraum für die Ergebnisbekanntgabe.',
            vibrate: [300, 100, 300, 100, 300, 100, 600],
          }),
        });
        if (response.ok) {
          alert('Ergebnisbekanntgabe wurde erfolgreich gesendet.');
        } else {
          const errData = (await response.json().catch(() => ({}))) as { error?: string };
          alert(`Fehler beim Senden: ${errData.error || response.statusText} (Status ${response.status})`);
        }
      } catch (e) {
        console.error(e);
        alert('Netzwerk-Fehler beim Ausrufen der Ergebnisbekanntgabe.');
      } finally {
        self.isSubmitting = false;
      }
    },

    /**
     * Quittiert einen eingehenden Rückrufwunsch im Leitstand.
     * @param {number} index - Index des Listenelements.
     */
    dismissCallback(index: number): void {
      const self = this as unknown as AdminSettingsComponent;
      if (index >= 0 && index < self.incomingCallbacks.length) {
        self.incomingCallbacks.splice(index, 1);
      }
    },

    /**
     * Speichert die angepassten Telefonkontakte über das Admin-API.
     * Bereinigt vorab verbotene Sonderzeichen zum Schutz vor Injektionen.
     * @returns {Promise<void>}
     */
    async saveSettings(): Promise<void> {
      const self = this as unknown as AdminSettingsComponent;
      if (self.isSubmitting) return;

      const cleanName = (val: string): string =>
        (val || '').replace(/[^a-zA-Z0-9\s,\-/äöüÄÖÜßéèàáíóúÉÈÀÁÍÓÚ]/g, '').trim().substring(0, 32);

      const cleanPhone = (val: string): string => {
        let clean = (val || '').trim().substring(0, 24);
        const hasPlus = clean.startsWith('+');
        clean = clean.replace(/[^0-9]/g, '');
        return hasPlus ? `+${clean}` : clean;
      };

      const cleanLeitstelleName = cleanName(self.phoneLeitstelleName);
      const cleanLeitstelleNum = cleanPhone(self.phoneLeitstelleNumber);
      const cleanPruefungName = cleanName(self.phonePruefungsleitungName);
      const cleanPruefungNum = cleanPhone(self.phonePruefungsleitungNumber);
      
      self.phoneLeitstelleName = cleanLeitstelleName;
      self.phoneLeitstelleNumber = cleanLeitstelleNum;
      self.phonePruefungsleitungName = cleanPruefungName;
      self.phonePruefungsleitungNumber = cleanPruefungNum;

      self.isSubmitting = true;

      try {
        const response = await fetch('/api/admin/settings', {
          method: 'POST',
          headers: {
            Authorization: self.password,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            settings: {
              phoneLeitstelleName: cleanLeitstelleName,
              phoneLeitstelleNumber: cleanLeitstelleNum,
              phonePruefungsleitungName: cleanPruefungName,
              phonePruefungsleitungNumber: cleanPruefungNum,
            },
          }),
        });
        
        if (response.ok) {
          alert('Die Einstellungen wurden erfolgreich gespeichert.');
        } else {
          const errData = (await response.json().catch(() => ({}))) as { error?: string };
          alert(errData.error || 'Fehler beim Speichern der Einstellungen.');
        }
      } catch (e) {
        console.error(e);
        alert('Netzwerk-Fehler beim Speichern der Einstellungen.');
      } finally {
        self.isSubmitting = false;
      }
    },

    /**
     * Löst den manuellen Neustart des Serverprozesses aus.
     * @returns {Promise<void>}
     */
    async triggerSystemRestart(): Promise<void> {
      const self = this as unknown as AdminSettingsComponent;
      if (!confirm('Möchten Sie den Serverprozess wirklich neu starten?')) return;

      self.showUpdateStatusModal = true;
      self.updateStep = 'restarting';
      self.updateErrorMessage = '';

      try {
        await fetch('/api/admin/restart', {
          method: 'POST',
          headers: { Authorization: self.password },
        });

        setTimeout(() => {
          self.pollServerPing();
        }, 3000);
      } catch (e) {
        setTimeout(() => {
          self.pollServerPing();
        }, 3000);
      }
    },

    /**
     * Pollt die `/api/ping`-Schnittstelle nach einem Server-Neustart.
     * @returns {Promise<void>}
     */
    async pollServerPing(): Promise<void> {
      const self = this as unknown as AdminSettingsComponent;
      self.updateStep = 'reconnecting';
      let attempts = 0;
      const maxAttempts = 30;

      const interval = setInterval(async () => {
        attempts += 1;
        try {
          const res = await fetch('/api/ping', { cache: 'no-store' });
          if (res.ok) {
            clearInterval(interval);
            self.updateStep = 'ready';
          }
        } catch (e) {
          if (attempts >= maxAttempts) {
            clearInterval(interval);
            self.updateStep = 'failed';
            self.updateErrorMessage = 'Der Server konnte nach dem Neustart nicht erreicht werden. Bitte prüfen Sie die Server-Logs.';
          }
        }
      }, 1500);
    },

    getUpdateTitle(): string {
      const self = this as unknown as AdminSettingsComponent;
      switch (self.updateStep) {
        case 'upload': return 'Paket wird hochgeladen...';
        case 'extract': return 'Update wird entpackt & verifiziert...';
        case 'restarting': return 'Server startet neu...';
        case 'reconnecting': return 'Warte auf Server-Verbindung...';
        case 'ready': return 'Update erfolgreich!';
        case 'failed': return 'Update fehlgeschlagen';
        default: return 'System-Aktualisierung';
      }
    },

    getUpdateDescription(): string {
      const self = this as unknown as AdminSettingsComponent;
      switch (self.updateStep) {
        case 'upload': return 'Bitte das Browserfenster nicht schließen.';
        case 'extract': return 'Dateien werden geprüft.';
        case 'restarting': return 'Der Serverprozess wird neu gestartet (ca. 5-10 Sek.).';
        case 'reconnecting': return 'Verbindung wird wiederhergestellt...';
        case 'ready': return 'Das System wurde erfolgreich aktualisiert.';
        case 'failed': return self.updateErrorMessage || 'Ein Fehler ist aufgetreten.';
        default: return '';
      }
    },

    reloadAfterUpdate(): void {
      window.location.reload();
    },

    /**
     * Bereinigt alte Repomix-Dateien, generiert ein frisches repomix-output.xml und lädt es herunter.
     */
    async downloadRepomix(): Promise<void> {
      const self = this as unknown as AdminSettingsComponent;
      if (self.isGeneratingRepomix) return;
      self.isGeneratingRepomix = true;

      try {
        const response = await fetch('/api/admin/system/repomix', {
          method: 'GET',
          headers: { Authorization: self.password },
        });

        if (response.ok) {
          if (window.gapFlowUtils) {
            const success = await window.gapFlowUtils.downloadFileFromResponse(response, 'repomix-output.xml');
            if (!success) {
              alert('Download fehlgeschlagen.');
            }
          }
        } else {
          const errData = (await response.json().catch(() => ({}))) as { error?: string };
          alert(errData.error || 'Fehler bei der Repomix-Generierung.');
        }
      } catch (e) {
        console.error(e);
        alert('Netzwerk-Fehler beim Generieren der Repomix-Datei.');
      } finally {
        self.isGeneratingRepomix = false;
      }
    },

    /**
     * Lädt das Server-, Kompilierungs- und Service-Worker-Protokoll in einer kombinierten Ansicht.
     */
    async fetchServerLog(): Promise<void> {
      const self = this as unknown as AdminSettingsComponent;
      try {
        const response = await fetch('/api/admin/system/logs', {
          method: 'GET',
          headers: { Authorization: self.password },
        });
        if (response.ok) {
          const data = (await response.json()) as {
            hasBuildError: boolean;
            buildErrorLog: string;
            uptimeSeconds: number;
            serverTime: string;
          };
          self.hasBuildError = data.hasBuildError;
          if (data.hasBuildError && data.buildErrorLog) {
            self.serverLogText = `⚠️ FEHLER BEIM LETZTEN GIT-UPDATE KOMPILIEREN:\n\n${data.buildErrorLog}\n\nServer läuft im sicheren Standby mit dem letzten funktionierenden Code.`;
          } else {
            const mins = Math.floor(data.uptimeSeconds / 60);
            self.serverLogText = `🟢 SYSTEM NORMAL & STABIL\n\nServer-Uptime: ${mins} Minuten\nServer-Zeit: ${data.serverTime}\n\nKeine Kompilierungsfehler aufgetreten. Das System arbeitet ordnungsgemäß.`;
          }
          self.showServerLogModal = true;
        } else {
          alert('Protokoll konnte nicht geladen werden.');
        }
      } catch (e) {
        console.error(e);
        alert('Netzwerk-Fehler beim Abrufen des Protokolls.');
      }
    },
  };

  if (typeof window.createAdminPanel === 'function') {
    return window.createAdminPanel(coreConfig);
  }
  return coreConfig;
};
