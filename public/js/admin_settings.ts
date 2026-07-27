// Version Tracker: public/js/admin_settings.ts (GAP-Flow v1.0.2)

/**
 * Schnittstelle für die Admin-Settings-Alpine-Komponente.
 */
interface AdminSettingsComponent {
  phoneLeitstelleName: string;
  phoneLeitstelleNumber: string;
  phonePruefungsleitungName: string;
  phonePruefungsleitungNumber: string;
  isSubmitting: boolean;
  password: string;
  showUpdateStatusModal: boolean;
  updateStep: string;
  updateErrorMessage: string;

  initSocket(): void;
  saveSettings(): Promise<void>;
  downloadSystemBackup(): Promise<void>;
  uploadSystemUpdate(event: Event): Promise<void>;
  triggerSystemRestart(): Promise<void>;
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
    isSubmitting: false,
    showUpdateStatusModal: false,
    updateStep: '',
    updateErrorMessage: '',

    initSocket(): void {
      const self = this as unknown as AdminSettingsComponent;
      self.connectSocket((state: Record<string, unknown>) => {
        const settings = (state.settings || {}) as Record<string, string>;
        self.phoneLeitstelleName = settings.phoneLeitstelleName || '';
        self.phoneLeitstelleNumber = settings.phoneLeitstelleNumber || '';
        self.phonePruefungsleitungName = settings.phonePruefungsleitungName || '';
        self.phonePruefungsleitungNumber = settings.phonePruefungsleitungNumber || '';
      });
    },

    /**
     * Speichert die angepassten Telefonkontakte über das Admin-API.
     * Bereinigt vorab verbotene Sonderzeichen zum Schutz vor Injektionen.
     * @returns {Promise<void>}
     */
    async saveSettings(): Promise<void> {
      const self = this as unknown as AdminSettingsComponent;
      if (self.isSubmitting) return;

      const cleanLeitstelleName = (self.phoneLeitstelleName || '').replace(/[^a-zA-Z0-9\s\-.,äöüÄÖÜß/()]/g, '').trim().substring(0, 32);
      const cleanLeitstelleNum = (self.phoneLeitstelleNumber || '').replace(/[^a-zA-Z0-9\s+\/\-().,äöüÄÖÜß]/g, '').trim().substring(0, 32);
      const cleanPruefungName = (self.phonePruefungsleitungName || '').replace(/[^a-zA-Z0-9\s\-.,äöüÄÖÜß/()]/g, '').trim().substring(0, 32);
      const cleanPruefungNum = (self.phonePruefungsleitungNumber || '').replace(/[^a-zA-Z0-9\s+\/\-().,äöüÄÖÜß]/g, '').trim().substring(0, 32);
      
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
     * Initiiert den Download des aktuellen System-Backups als ZIP-Archiv.
     * @returns {Promise<void>}
     */
    async downloadSystemBackup(): Promise<void> {
      const self = this as unknown as AdminSettingsComponent;
      if (self.isSubmitting) return;
      self.isSubmitting = true;
      try {
        const response = await fetch('/api/admin/update/download', {
          method: 'GET',
          headers: { Authorization: self.password },
        });

        if (window.gapFlowUtils) {
          const success = await window.gapFlowUtils.downloadFileFromResponse(response, 'GAP-Flow_Code.zip');
          if (!success) {
            alert('Download fehlgeschlagen: Nicht autorisiert oder ungültige Serverrückmeldung.');
          }
        }
      } catch (e) {
        console.error(e);
        alert('Netzwerk-Fehler beim Herunterladen des Backups.');
      } finally {
        self.isSubmitting = false;
      }
    },

    /**
     * Lädt ein Update-ZIP-Paket hoch.
     * @param {Event} event - Das File-Input Change-Event.
     * @returns {Promise<void>}
     */
    async uploadSystemUpdate(event: Event): Promise<void> {
      const self = this as unknown as AdminSettingsComponent;
      const targetInput = event.target as HTMLInputElement | null;
      if (!targetInput || !targetInput.files || targetInput.files.length === 0) return;

      const file = targetInput.files[0];
      if (!confirm(`Möchten Sie das Update-Paket "${file.name}" jetzt installieren und den Server neu starten?`)) {
        targetInput.value = '';
        return;
      }

      self.showUpdateStatusModal = true;
      self.updateStep = 'upload';
      self.updateErrorMessage = '';

      try {
        const arrayBuffer = await file.arrayBuffer();
        self.updateStep = 'extract';

        const response = await fetch('/api/admin/update/upload', {
          method: 'POST',
          headers: {
            Authorization: self.password,
            'Content-Type': 'application/zip',
          },
          body: arrayBuffer,
        });

        if (response.ok) {
          self.updateStep = 'restarting';
          setTimeout(() => {
            self.pollServerPing();
          }, 3000);
        } else {
          const errData = (await response.json().catch(() => ({}))) as { error?: string };
          self.updateStep = 'failed';
          self.updateErrorMessage = errData.error || 'Fehler beim Upload des Update-Pakets.';
        }
      } catch (e) {
        const error = e as Error;
        self.updateStep = 'failed';
        self.updateErrorMessage = `Netzwerkfehler: ${error.message}`;
      } finally {
        targetInput.value = '';
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
  };

  if (typeof window.createAdminPanel === 'function') {
    return window.createAdminPanel(coreConfig);
  }
  return coreConfig;
};
