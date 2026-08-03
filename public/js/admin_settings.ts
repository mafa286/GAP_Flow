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

interface SubStationOption {
  id: string;
  masterId: string;
  masterName: string;
  examiner: string;
  active: boolean;
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
  isGeneratingRepomix: boolean;
  stations: Record<string, any>;
  showCallbackPopup: boolean;
  popupCallbackType: 'leitstelle' | 'pruefungsleitung';
  popupCallbackTargetSubId: string;

  initSocket(): void;
  saveSettings(): Promise<void>;
  sendBroadcastMessage(): Promise<void>;
  openCallbackPopup(type: 'leitstelle' | 'pruefungsleitung'): void;
  sendTargetedCallback(): Promise<void>;
  sendLeitstelleCallback(): Promise<void>;
  sendPruefungsleitungCallback(): Promise<void>;
  sendErgebnisbekanntgabe(): Promise<void>;
  getSubStationsList(): SubStationOption[];
  dismissCallback(index: number): void;
  triggerSystemRestart(): Promise<void>;
  downloadRepomix(): Promise<void>;
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
    isGeneratingRepomix: false,
    stations: {} as Record<string, any>,
    showCallbackPopup: false,
    popupCallbackType: 'leitstelle' as 'leitstelle' | 'pruefungsleitung',
    popupCallbackTargetSubId: '',

    initSocket(): void {
      const self = this as unknown as AdminSettingsComponent;
      self.connectSocket((state: Record<string, unknown>) => {
        const settings = (state.settings || {}) as Record<string, string>;
        self.phoneLeitstelleName = settings.phoneLeitstelleName || '';
        self.phoneLeitstelleNumber = settings.phoneLeitstelleNumber || '';
        self.phonePruefungsleitungName = settings.phonePruefungsleitungName || '';
        self.phonePruefungsleitungNumber = settings.phonePruefungsleitungNumber || '';
        self.stations = (state.stations || {}) as Record<string, any>;
      });

      if (window.adminSocket) {
        window.adminSocket.on('callbackRequested', (data: unknown) => {
          const item = data as CallbackItem;
          self.incomingCallbacks.unshift(item);
        });
      }
    },

    /**
     * Sendet einen manuellen Rundruf-Text per Web-Push an alle registrierten Geräte.
     * @returns {Promise<void>}
     */
    async sendBroadcastMessage(): Promise<void> {
      const self = this as unknown as AdminSettingsComponent;
      const text = self.broadcastText.trim();
      if (self.isSubmitting || !text) return;

      self.isSubmitting = true;
      try {
        const response = await fetch('/api/admin/notify', {
          method: 'POST',
          headers: { Authorization: self.password, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'broadcast',
            tag: 'broadcast',
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
     * Öffnet das Auswahl-Popup zur gezielten Rückrufanforderung an eine Unterstation.
     * @param {'leitstelle' | 'pruefungsleitung'} type - Die Art der Anforderung.
     * @returns {void}
     */
    openCallbackPopup(type: 'leitstelle' | 'pruefungsleitung'): void {
      const self = this as unknown as AdminSettingsComponent;
      self.popupCallbackType = type;
      self.popupCallbackTargetSubId = '';
      self.showCallbackPopup = true;
    },

    /**
     * Sendet die gezielte Rückrufanforderung an die ausgewählte Unterstation per Web-Push.
     * @returns {Promise<void>}
     */
    async sendTargetedCallback(): Promise<void> {
      const self = this as unknown as AdminSettingsComponent;
      if (self.isSubmitting || !self.popupCallbackTargetSubId) return;

      const isLeitstelle = self.popupCallbackType === 'leitstelle';
      const title = isLeitstelle ? '🚨 Rückruf Leitstelle' : '🚨 Rückruf Prüfungsleitung';
      const label = isLeitstelle ? 'Leitstelle' : 'Prüfungsleitung';
      const body = `🚨 ${label.toUpperCase()} BITTET UM RÜCKRUF! Bitte ${label} kontaktieren.`;
      const typeTag = isLeitstelle ? 'callback_leitstelle' : 'callback_pruefungsleitung';
      const phoneNumber = isLeitstelle ? self.phoneLeitstelleNumber : self.phonePruefungsleitungNumber;

      self.isSubmitting = true;
      try {
        const response = await fetch('/api/admin/notify', {
          method: 'POST',
          headers: { Authorization: self.password, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: typeTag,
            tag: typeTag,
            title,
            body,
            targetSubId: self.popupCallbackTargetSubId,
            vibrate: [500, 150, 500, 150, 500],
            data: {
              phoneNumber: phoneNumber || undefined,
            },
          }),
        });
        if (response.ok) {
          alert(`Rückrufanforderung der ${label} wurde erfolgreich an Station ${self.popupCallbackTargetSubId} gesendet.`);
          self.showCallbackPopup = false;
          self.popupCallbackTargetSubId = '';
        } else {
          const errData = (await response.json().catch(() => ({}))) as { error?: string };
          alert(`Fehler beim Senden: ${errData.error || response.statusText} (Status ${response.status})`);
        }
      } catch (e) {
        console.error(e);
        alert('Netzwerk-Fehler beim Senden der Rückrufanforderung.');
      } finally {
        self.isSubmitting = false;
      }
    },

    /**
     * Wandelt das verschachtelte Stationsobjekt in eine flache Liste von Unterstationen um.
     * @returns {SubStationOption[]} Liste der auswählbaren Unterstationen mit Push-Status.
     */
    getSubStationsList(): SubStationOption[] {
      const self = this as unknown as AdminSettingsComponent;
      const list: SubStationOption[] = [];

      Object.values(self.stations || {}).forEach((master: any) => {
        if (!master || !master.subStations) return;
        Object.values(master.subStations).forEach((sub: any) => {
          if (!sub) return;
          list.push({
            id: sub.id,
            masterId: master.id,
            masterName: master.name,
            examiner: sub.examiner || '',
            active: sub.active !== false && master.active !== false,
            hasPushSub: !!sub.hasPushSub,
          });
        });
      });

      return list.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    },

    /**
     * Abwärtskompatibler Wrapper für Leitstellen-Rückrufe.
     * @returns {Promise<void>}
     */
    async sendLeitstelleCallback(): Promise<void> {
      this.openCallbackPopup('leitstelle');
    },

    /**
     * Abwärtskompatibler Wrapper für Prüfungsleitungs-Rückrufe.
     * @returns {Promise<void>}
     */
    async sendPruefungsleitungCallback(): Promise<void> {
      this.openCallbackPopup('pruefungsleitung');
    },

    /**
     * Sendet den Sammelaufruf zur offiziellen Ergebnisbekanntgabe an alle Mobilgeräte.
     * @returns {Promise<void>}
     */
    async sendErgebnisbekanntgabe(): Promise<void> {
      const self = this as unknown as AdminSettingsComponent;
      if (self.isSubmitting) return;
      if (!confirm('Soll die Ergebnisbekanntgabe an alle Geräte ausgerufen werden?')) return;

      self.isSubmitting = true;
      try {
        const response = await fetch('/api/admin/notify', {
          method: 'POST',
          headers: { Authorization: self.password, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'result_announcement',
            tag: 'result_announcement',
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
     * Quittiert und entfernt eine eingegangene Rückrufanforderung im Leitstand-Dashboard.
     * @param {number} index - Index des Listenelements.
     * @returns {void}
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
      if (self.isSubmitting) return;
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
     * Pollt die `/api/ping`-Schnittstelle nach einem Server-Neustart und prüft anschließend Kompilierungsfehler.
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
            try {
              const logRes = await fetch('/api/admin/system/logs', {
                headers: { Authorization: self.password },
              });
              if (logRes.ok) {
                const logData = (await logRes.json()) as {
                  hasBuildError: boolean;
                  buildErrorLog: string;
                };
                if (logData.hasBuildError && logData.buildErrorLog) {
                  self.updateStep = 'failed';
                  self.updateErrorMessage = `⚠️ FEHLER BEIM LETZTEN KOMPILIEREN:\n\n${logData.buildErrorLog}\n\nServer läuft im sicheren Standby mit dem letzten funktionierenden Code.`;
                  return;
                }
              }
            } catch (_) {}
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
        case 'ready': return 'Neustart erfolgreich!';
        case 'failed': return 'Kompilierungsfehler beim Neustart';
        default: return 'System-Aktualisierung';
      }
    },

    getUpdateDescription(): string {
      const self = this as unknown as AdminSettingsComponent;
      switch (self.updateStep) {
        case 'upload': return 'Bitte das Browserfenster nicht schließen.';
        case 'extract': return 'Dateien werden im Staging-Bereich entpackt und geprüft.';
        case 'restarting': return 'Der Serverprozess wird neu gestartet (ca. 5-10 Sek.).';
        case 'reconnecting': return 'Verbindung wird wiederhergestellt...';
        case 'ready': return 'Das System wurde erfolgreich gestartet. Es sind keine Kompilierungsfehler aufgetreten.';
        case 'failed': return self.updateErrorMessage || 'Ein unerwarteter Fehler ist aufgetreten.';
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
  };

  if (typeof window.createAdminPanel === 'function') {
    return window.createAdminPanel(coreConfig);
  }
  return coreConfig;
};
