interface GroupMember {
  name: string;
  active: boolean;
}

interface ExaminerGroupDetails {
  id: string;
  name: string;
  members: GroupMember[];
}

interface FlatExaminerPayload {
  subStation: {
    id: string;
    examiner: string;
    paused: boolean;
    currentGroupId: string | null;
    startTime: number | null;
    active: boolean;
  };
  masterName: string;
  remainingGroups: number;
  waitingGroups: number;
  currentGroupDetails: ExaminerGroupDetails | null;
  totalActiveGroups?: number;
  completedThisMaster?: number;
  reservedGroupName?: string;
  isRegistered?: boolean;
  isAuthorized?: boolean;
  isClaimed?: boolean;
  settings?: {
    phoneLeitstelleName?: string;
    phoneLeitstelleNumber?: string;
    phonePruefungsleitungName?: string;
    phonePruefungsleitungNumber?: string;
  };
}

interface SocketIoClient {
  disconnect: () => void;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface ExaminerComponent {
  token: string;
  subId: string;
  examinerName: string;
  masterName: string;
  isPaused: boolean;
  currentGroup: ExaminerGroupDetails | null;
  startTime: number | null;
  remainingGroups: number;
  waitingGroups: number;
  now: number;
  reservedGroupName: string;
  isRegistered: boolean;
  isAuthorized: boolean;
  isClaimed: boolean;
  regFirstName: string;
  regLastName: string;
  hasInitialized: boolean;
  soundUnlocked: boolean;
  wakeLock: WakeLockSentinel | null;
  isSubmitting: boolean;
  audioContext: AudioContext | null;
  receivedSocketUpdate: boolean;
  connected: boolean;
  showConfirmComplete: boolean;
  showErrorAlert: boolean;
  isNetworkErrorAlert: boolean;
  errorMessage: string;
  retryAction: (() => void) | null;
  showStartSetup: boolean;
  totalActiveGroups: number;
  completedThisMaster: number;
  tokenError: boolean;
  isDeactivated: boolean;
  renderLock: boolean;
  graceTicks: number;
  graceTimer: ReturnType<typeof setInterval> | null;
  pauseOnComplete: boolean;
  freezeUI: boolean;
  isInstalled: boolean;
  isInstallPromptReady: boolean;
  deferredPrompt: BeforeInstallPromptEvent | null;
  appInstalledSuccessfully: boolean;
  isCompiling: boolean;
  _lastInfoSoundTime: number;
  _lastSubscribedSubId?: string;

  showFunctionsMenu: boolean;
  showPermissionsModal: boolean;
  showGuideModal: boolean;
  showNotificationSettingsModal: boolean;
  phoneLeitstelleName: string;
  phoneLeitstelleNumber: string;
  phonePruefungsleitungName: string;
  phonePruefungsleitungNumber: string;
  notificationPermissionStatus: string;
  appVersion: string;

  _postApi(endpoint: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<Response>;
  forceAppUpdate(): Promise<void>;
  checkPermissions(): void;
  requestNotificationPermission(): Promise<void>;
  sendServerTestNotification(): Promise<void>;
  subscribeToWebPush(forceFresh?: boolean): Promise<void>;
  openCallLink(phoneNumber: string, label: string): void;
  requestCallback(target: 'leitstelle' | 'pruefungsleitung'): void;
  init(): void;
  isIOS(): boolean;
  triggerAndroidInstallPrompt(): void;
  initSocket(): void;
  getElapsedMinutes(): number;
  applyFlatState(data: FlatExaminerPayload): void;
  updateFromState(state: FlatExaminerPayload): void;
  startGracePeriod(): void;
  abortGracePeriod(): void;
  executeCompleteWithPause(): Promise<void>;
  playInfoSound(): void;
  playVictoryMelody(): void;
  fetchStatus(): Promise<void>;
  completeGroup(): void;
  handleError(action: string, error: Error, retryFn?: (() => void) | null): void;
  triggerRetry(): void;
  registerExaminer(): Promise<void>;
  deregisterExaminer(): Promise<void>;
  executeTogglePause(state: boolean): Promise<void>;
  triggerReadySetup(): Promise<void>;
  requestWakeLock(): Promise<void>;
  unlockSound(): void;
}

let globalDeferredInstallPrompt: BeforeInstallPromptEvent | null = null;

window.addEventListener('beforeinstallprompt', (e: Event) => {
  e.preventDefault();
  globalDeferredInstallPrompt = e as BeforeInstallPromptEvent;
  if (window.examinerPanelInstance) {
    (window.examinerPanelInstance as Record<string, unknown>).deferredPrompt = globalDeferredInstallPrompt;
    (window.examinerPanelInstance as Record<string, unknown>).isInstallPromptReady = true;
  }
});

function examiner(): ExaminerComponent {
  return {
    token: '',
    subId: '',
    examinerName: '',
    masterName: '',
    isPaused: false,
    currentGroup: null,
    startTime: null,
    remainingGroups: 0,
    waitingGroups: 0,
    now: Date.now(),
    reservedGroupName: '',
    isRegistered: false,
    isAuthorized: false,
    isClaimed: false,
    regFirstName: '',
    regLastName: '',
    hasInitialized: false,
    soundUnlocked: false,
    wakeLock: null,
    isSubmitting: false,
    audioContext: null,
    receivedSocketUpdate: false,
    connected: false,
    showConfirmComplete: false,
    showErrorAlert: false,
    isNetworkErrorAlert: false,
    errorMessage: '',
    retryAction: null,
    showStartSetup: false,
    totalActiveGroups: 0,
    completedThisMaster: 0,
    tokenError: false,
    isDeactivated: false,
    renderLock: false,
    graceTicks: 70,
    graceTimer: null,
    pauseOnComplete: false,
    freezeUI: false,
    isInstalled: true,
    isInstallPromptReady: false,
    deferredPrompt: null,
    appInstalledSuccessfully: false,
    isCompiling: false,
    _lastInfoSoundTime: 0,
    _lastSubscribedSubId: '',

    showFunctionsMenu: false,
    showPermissionsModal: false,
    showGuideModal: false,
    showNotificationSettingsModal: false,
    phoneLeitstelleName: '',
    phoneLeitstelleNumber: '',
    phonePruefungsleitungName: '',
    phonePruefungsleitungNumber: '',
    notificationPermissionStatus: 'default',
    get appVersion(): string {
      return (window as any).GAP_FLOW_VERSION ? `v${(window as any).GAP_FLOW_VERSION}` : 'v0.0';
    },

    /**
     * Erzwingt ein Leeren des lokalen PWA-Caches und lädt die Anwendung frisch vom Server.
     */
    async forceAppUpdate(): Promise<void> {
      if (!confirm('Soll der lokale PWA-Cache geleert und die App neu vom Server geladen werden?')) return;
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const reg of regs) {
            await reg.unregister();
          }
        }
        if ('caches' in window) {
          const keys = await caches.keys();
          for (const key of keys) {
            await caches.delete(key);
          }
        }
      } catch (e) {
        console.error('Fehler beim Leeren des Caches:', e);
      }
      window.location.reload();
    },

    /**
     * Führt einen direkten lokalen Benachrichtigungstest im PWA-Kontext aus.
     */
    async sendServerTestNotification(): Promise<void> {
      if (window.prueferPush) {
        await window.prueferPush.sendServerTestNotification(this);
      }
    },

    /**
     * Sendet eine sofortige Rückrufanforderung an die Leitstelle oder Prüfungsleitung.
     * @param {'leitstelle' | 'pruefungsleitung'} target - Das Ziel der Rückrufanforderung.
     * @returns {void}
     */
    requestCallback(target: 'leitstelle' | 'pruefungsleitung'): void {
      const targetName = target === 'pruefungsleitung' ? 'Prüfungsleitung' : 'Leitstelle';
      if (!confirm(`Möchten Sie wirklich einen dringenden Rückruf durch die ${targetName} anfordern?`)) return;

      const contactPhone = target === 'pruefungsleitung' ? this.phonePruefungsleitungNumber : this.phoneLeitstelleNumber;
      if (window.examinerSocket && window.examinerSocket.connected) {
        window.examinerSocket.emit('requestCallback', {
          target,
          subId: this.subId,
          examinerName: this.examinerName,
          phoneNumber: contactPhone || '',
        });
        alert(`🚨 Rückrufwunsch an die ${targetName} wurde erfolgreich übermittelt!`);
      } else {
        alert('Keine Verbindung zum Server. Rückrufwunsch konnte nicht übermittelt werden.');
      }
    },
    
    /**
     * Überprüft den aktuellen Berechtigungsstatus im Browser (z.B. System-Push-Benachrichtigungen).
     * @returns {void}
     */
    checkPermissions(): void {
      if (window.prueferPush) {
        this.notificationPermissionStatus = window.prueferPush.checkPermissions();
      }
    },

    /**
     * Fordert beim Benutzer die System-Benachrichtigungsberechtigung für PWA-Pushs an.
     * @returns {Promise<void>}
     */
    async requestNotificationPermission(): Promise<void> {
      if (window.prueferPush) {
        this.notificationPermissionStatus = await window.prueferPush.requestNotificationPermission(this);
      }
    },

    /**
     * Registriert das Smartphone beim W3C Web Push Service für Push-Benachrichtigungen im Standby.
     */
    async subscribeToWebPush(forceFresh = false): Promise<void> {
      if (window.prueferPush) {
        await window.prueferPush.subscribeToWebPush(this, forceFresh);
      }
    },

    /**
     * Öffnet einen Anruf-Link (tel:) oder zeigt einen Hinweis, falls keine Rufnummer hinterlegt ist.
     * @param {string} phoneNumber - Die anzurufende Telefonnummer.
     * @param {string} label - Die Bezeichnung der Anrufstelle (z.B. Leitstelle).
     * @returns {void}
     */
    openCallLink(phoneNumber: string, label: string): void {
      if (phoneNumber && phoneNumber.trim()) {
        window.location.href = `tel:${phoneNumber.trim()}`;
      } else {
        alert(`Keine Telefonnummer für "${label}" im System hinterlegt. Die Verwaltung erfolgt über die Admin-Einstellungen.`);
      }
    },

    init(): void {
      const params = new URLSearchParams(window.location.search);
      const tokenFromUrl = params.get('token');

      const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true;
      this.isInstalled = isStandalone;

      if (isStandalone) {
        localStorage.setItem('pwa_installed_and_opened', 'true');
      } else if (localStorage.getItem('pwa_installed_and_opened') === 'true') {
        this.appInstalledSuccessfully = true;
      }

      window.examinerPanelInstance = this;
      if (globalDeferredInstallPrompt) {
        this.deferredPrompt = globalDeferredInstallPrompt;
        this.isInstallPromptReady = true;
      }

      if (tokenFromUrl) {
        localStorage.setItem('examiner_token', tokenFromUrl);
        this.token = tokenFromUrl;
      } else {
        const storedToken = localStorage.getItem('examiner_token');
        if (storedToken) {
          this.token = storedToken;
          const newUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}?token=${encodeURIComponent(storedToken)}`;
          window.history.replaceState({ path: newUrl }, '', newUrl);
        }
      }

      const silentUnlock = () => {
        document.removeEventListener('click', silentUnlock);
        document.removeEventListener('touchend', silentUnlock);
        if (!this.soundUnlocked) {
          this.unlockSound();
        }
      };
      document.addEventListener('click', silentUnlock);
      document.addEventListener('touchend', silentUnlock);

      if (window.location.hash === '#settings-notifications') {
        this.showNotificationSettingsModal = true;
      }

      if (this.token) {
        this.fetchStatus();
        this.initSocket();

        if ('Notification' in window && Notification.permission === 'granted') {
          this.subscribeToWebPush();
        }

        setInterval(() => {
          this.now = Date.now();
        }, 1000);

        if (window.gapFlowUtils) {
          window.gapFlowUtils.bindAutoWakeLock(this);
        }
      }

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
          if (event.data && event.data.type === 'PUSH_RECEIVED') {
            const payload = event.data.payload || {};
            if (this.soundUnlocked) {
              this.playInfoSound();
            }
            if ('vibrate' in navigator && payload.vibrate) {
              try { navigator.vibrate(payload.vibrate); } catch (_) {}
            }
            this.fetchStatus();
          }
        });

        const requestSwVersion = () => {
          if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ type: 'GET_VERSION' });
          } else {
            navigator.serviceWorker.ready.then((reg) => {
              if (reg.active) {
                reg.active.postMessage({ type: 'GET_VERSION' });
              }
            });
          }
        };

        window.addEventListener('load', () => {
          navigator.serviceWorker
            .register('/sw.js')
            .then((reg) => {
              console.log('[PWA] Service Worker erfolgreich registriert:', reg.scope);
              reg.update();
              requestSwVersion();
            })
            .catch((err) => {
              console.error('[PWA] Service Worker Registrierung fehlgeschlagen:', err);
            });
        });

        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible' && 'serviceWorker' in navigator) {
            navigator.serviceWorker.ready.then((reg) => {
              reg.update();
            });
          }
        });

        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (refreshing) return;
          refreshing = true;
          window.location.reload();
        });

        setTimeout(() => {
          requestSwVersion();
        }, 1000);
      }

      if (window.prueferPwaHelper) {
        window.prueferPwaHelper.setupInstallTracking(this);
      }
    },

    isIOS(): boolean {
      return window.prueferPwaHelper ? window.prueferPwaHelper.isIOS() : false;
    },

    triggerAndroidInstallPrompt(): void {
      if (window.prueferPwaHelper) {
        window.prueferPwaHelper.triggerAndroidInstallPrompt(this);
      }
    },

    initSocket(): void {
      if (!this.token) {
        this.connected = false;
        return;
      }

      try {
        if (window.examinerSocket) {
          window.examinerSocket.disconnect();
        }

        if (typeof window.io === 'function') {
          window.examinerSocket = window.io({
            auth: {
              role: 'examiner',
              token: this.token,
              deviceToken: localStorage.getItem('device_token'),
            },
          });

          window.examinerSocket.on('connect', () => {
            this.connected = true;
            this.fetchStatus();
          });

          window.examinerSocket.on('disconnect', () => {
            this.connected = false;
          });

          window.examinerSocket.on('connect_error', (err: unknown) => {
            this.connected = false;
            const error = err as Error;
            if (error.message === 'Authentication error' || error.message === 'Invalid role') {
              this.tokenError = true;
            }
          });

          window.examinerSocket.on('stateUpdate', (state: unknown) => {
            this.renderLock = true;
            this.receivedSocketUpdate = true;

            if (this.isNetworkErrorAlert && this.retryAction) {
              this.triggerRetry();
              return;
            }

            this.updateFromState(state as FlatExaminerPayload);

            setTimeout(() => {
              this.renderLock = false;
            }, 0);
          });
        }
      } catch (e) {
        console.error('Socket.io nicht erreichbar:', e);
      }
    },

    /**
     * Berechnet die bisher verstrichene Prüfungsdauer der aktiven Gruppe in Minuten.
     * @returns {number} Vergangene Zeit in Minuten.
     */
    getElapsedMinutes(): number {
      if (!this.startTime) return 0;
      const diffMs = this.now - this.startTime;
      return Math.max(0, Math.floor(diffMs / 60000));
    },

    /**
     * Übernimmt das vom Server empfangene flache Zustandsobjekt in die lokale Alpine-Komponente.
     * @param {FlatExaminerPayload} data - Das Zustandsobjekt der Unterstation.
     * @returns {void}
     */
    applyFlatState(data: FlatExaminerPayload): void {
      this.tokenError = false;

      const oldGroupId = this.currentGroup ? this.currentGroup.id : null;
      const oldPaused = this.isPaused;

      const oldSubId = this.subId;
      this.subId = data.subStation.id;
      this.examinerName = data.subStation.examiner;
      this.masterName = data.masterName;
      this.isPaused = data.subStation.paused;
      this.startTime = data.subStation.startTime;
      this.isDeactivated = data.subStation.active === false;
      this.remainingGroups = data.remainingGroups;
      this.waitingGroups = data.waitingGroups;
      this.totalActiveGroups = data.totalActiveGroups || 0;
      this.completedThisMaster = data.completedThisMaster || 0;
      this.reservedGroupName = data.reservedGroupName || '';
      this.isRegistered = data.isRegistered || false;
      this.isAuthorized = data.isAuthorized || false;
      this.isClaimed = data.isClaimed || false;

      if (this.subId && (this.subId !== oldSubId || !this._lastSubscribedSubId)) {
        this._lastSubscribedSubId = this.subId;
        if ('Notification' in window && Notification.permission === 'granted') {
          this.subscribeToWebPush();
        }
      }

      if (data.settings) {
        this.phoneLeitstelleName = data.settings.phoneLeitstelleName || '';
        this.phoneLeitstelleNumber = data.settings.phoneLeitstelleNumber || '';
        this.phonePruefungsleitungName = data.settings.phonePruefungsleitungName || '';
        this.phonePruefungsleitungNumber = data.settings.phonePruefungsleitungNumber || '';
      }
      if (data.currentGroupDetails) {
        this.currentGroup = {
          id: data.currentGroupDetails.id,
          name: data.currentGroupDetails.name,
          members: data.currentGroupDetails.members,
        };
      } else {
        this.currentGroup = null;
      }

      const newGroupId = this.currentGroup ? this.currentGroup.id : null;
      const groupChanged = oldGroupId !== newGroupId;
      const pauseChanged = oldPaused !== this.isPaused;

      if (this.hasInitialized && (groupChanged || pauseChanged)) {
        if (oldGroupId && !newGroupId && this.remainingGroups === 0) {
          this.playVictoryMelody();
        } else {
          this.playInfoSound();
        }
      }
      this.hasInitialized = true;
    },

    /**
     * Hilfsmethode zum Senden von POST-Anfragen an die Prüfer-API.
     */
    async _postApi(endpoint: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<Response> {
      const headers: Record<string, string> = {
        Authorization: this.token,
        ...extraHeaders,
      };
      const options: RequestInit = { method: 'POST', headers };
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      }
      return fetch(`/api/examiner/${endpoint}`, options);
    },

    /**
     * Verarbeitet Echtzeit-Statusupdates unter Berücksichtigung aktiver Eingabe-Countdowns.
     * @param {FlatExaminerPayload} state - Das empfangene Zustandsobjekt.
     * @returns {void}
     */
    updateFromState(state: FlatExaminerPayload): void {
      if (this.freezeUI) {
        const serverGroupId = state.subStation ? state.subStation.currentGroupId : null;
        const localGroupId = this.currentGroup ? this.currentGroup.id : null;

        if (localGroupId && serverGroupId !== localGroupId) {
          this.abortGracePeriod();
        } else {
          return;
        }
      }
      this.applyFlatState(state);
    },

    /**
     * Startet den 7-Sekunden-Countdown vor der endgültigen Übermittlung des Prüfungsabschlusses.
     * @returns {void}
     */
    startGracePeriod(): void {
      this.showConfirmComplete = false;
      this.freezeUI = true;
      this.graceTicks = 70;
      this.pauseOnComplete = false;

      if (this.graceTimer) {
        clearInterval(this.graceTimer);
      }

      this.graceTimer = setInterval(() => {
        this.graceTicks -= 1;
        if (this.graceTicks <= 0) {
          if (this.graceTimer) {
            clearInterval(this.graceTimer);
            this.graceTimer = null;
          }
          this.executeCompleteWithPause();
        }
      }, 100);
    },

    /**
     * Bricht den laufenden Abschluss-Countdown ab und setzt das Interface zurück.
     * @returns {void}
     */
    abortGracePeriod(): void {
      if (this.graceTimer) {
        clearInterval(this.graceTimer);
        this.graceTimer = null;
      }
      this.graceTicks = 70;
      this.pauseOnComplete = false;
      this.freezeUI = false;
    },

    /**
     * Führt den Prüfungsabschluss und eine eventuell vorgemerkte Stationenpause aus.
     * @returns {Promise<void>}
     */
    async executeCompleteWithPause(): Promise<void> {
      this.freezeUI = false;
      this.isSubmitting = true;
      const needPause = this.pauseOnComplete;
      this.pauseOnComplete = false;

      try {
        if (needPause) {
          const pauseRes = await this._postApi('pause', { paused: true });
          if (!pauseRes.ok) {
            const errData = (await pauseRes.json().catch(() => ({}))) as { error?: string };
            throw new Error(errData.error || `HTTP Status ${pauseRes.status}`);
          }
        }

        const completeRes = await this._postApi('complete');

        if (!completeRes.ok) {
          const errData = (await completeRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(errData.error || `HTTP Status ${completeRes.status}`);
        }
      } catch (e) {
        const error = e as Error;
        this.handleError('Fehler beim Abschluss', error, () => {
          this.pauseOnComplete = needPause;
          this.executeCompleteWithPause();
        });
      } finally {
        this.isSubmitting = false;
      }
    },

    playInfoSound(): void {
      if (!this.soundUnlocked || !this.audioContext) return;

      const now = Date.now();
      if (this._lastInfoSoundTime && now - this._lastInfoSoundTime < 1500) {
        return;
      }
      this._lastInfoSoundTime = now;

      if (window.gapFlowAudio) {
        window.gapFlowAudio.playInfoSound(this.audioContext);
      }
    },

    playVictoryMelody(): void {
      if (!this.soundUnlocked || !this.audioContext) return;
      if (window.gapFlowAudio) {
        window.gapFlowAudio.playVictoryMelody(this.audioContext);
      }
    },

    async fetchStatus(): Promise<void> {
      this.receivedSocketUpdate = false;
      try {
        const res = await fetch('/api/examiner/status', {
          headers: {
            Authorization: this.token,
            'X-Device-Token': localStorage.getItem('device_token') || '',
          },
        });
        if (res.status === 401) {
          const errData = (await res.json().catch(() => ({}))) as { deactivated?: boolean };
          if (errData.deactivated) {
            this.isDeactivated = true;
          }
          this.tokenError = true;
          return;
        }

        if (!res.ok) {
          throw new Error(`HTTP-Fehler! Status: ${res.status}`);
        }

        this.tokenError = false;

        if (this.isNetworkErrorAlert && this.retryAction) {
          this.triggerRetry();
        }

        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          throw new Error('Der Server lieferte kein gültiges JSON-Format.');
        }

        const data = (await res.json()) as FlatExaminerPayload;

        if (this.receivedSocketUpdate) {
          console.log('[Race-Condition Protection] Veraltetes HTTP-Statusupdate verworfen.');
          return;
        }

        this.applyFlatState(data);
      } catch (e) {
        const error = e as Error;
        console.error('Netzwerk- oder Verarbeitungsfehler im Prüfer-Panel:', error.message);
      }
    },

    completeGroup(): void {
      if (this.isSubmitting) return;
      this.showConfirmComplete = true;
    },

    handleError(action: string, error: Error, retryFn?: (() => void) | null): void {
      const isNet =
        error.message.includes('fetch') ||
        error.message.includes('NetworkError') ||
        error.message.includes('Failed to fetch') ||
        !navigator.onLine;
      if (isNet) {
        this.errorMessage =
          'Es konnte keine Verbindung zum Server hergestellt werden. Bitte prüfen Sie Ihre WLAN- oder Mobilfunkverbindung auf dem Gelände und versuchen Sie es erneut.';
        this.isNetworkErrorAlert = true;
        this.retryAction = retryFn || null;
      } else {
        this.errorMessage = `${action}: ${error.message}`;
        this.isNetworkErrorAlert = false;
        this.retryAction = null;
      }
      this.showErrorAlert = true;
    },

    triggerRetry(): void {
      this.showErrorAlert = false;
      this.isNetworkErrorAlert = false;
      if (this.retryAction) {
        const action = this.retryAction;
        this.retryAction = null;
        action();
      }
    },

    async registerExaminer(): Promise<void> {
      const firstInput = document.querySelector('input[name="firstname"]') as HTMLInputElement | null;
      const lastInput = document.querySelector('input[name="lastname"]') as HTMLInputElement | null;
      if (firstInput && firstInput.value && !this.regFirstName) {
        this.regFirstName = firstInput.value;
      }
      if (lastInput && lastInput.value && !this.regLastName) {
        this.regLastName = lastInput.value;
      }

      const cleanFirst = this.regFirstName.trim();
      const cleanLast = this.regLastName.trim();
      if (!cleanFirst || !cleanLast) return;
      this.isSubmitting = true;

      try {
        const response = await this._postApi('register', { firstName: cleanFirst, lastName: cleanLast });

        if (response.ok) {
          const data = (await response.json()) as { deviceToken: string };
          localStorage.setItem('device_token', data.deviceToken);
          this.initSocket();
          await this.fetchStatus();
        } else {
          const errData = (await response.json().catch(() => ({}))) as { error?: string };
          alert(errData.error || 'Fehler beim Belegen der Station.');
        }
      } catch (e) {
        console.error(e);
        alert('Netzwerkfehler bei der Registrierung.');
      } finally {
        this.isSubmitting = false;
      }
    },

    async deregisterExaminer(): Promise<void> {
      if (!confirm('Möchten Sie sich wirklich abmelden? Die Station wird augenblicklich für andere Geräte freigegeben.')) return;
      this.isSubmitting = true;
      try {
        const response = await this._postApi('deregister', undefined, {
          'X-Device-Token': localStorage.getItem('device_token') || '',
        });

        if (response.ok) {
          localStorage.removeItem('device_token');
          this.initSocket();
          await this.fetchStatus();
        } else {
          const errData = (await response.json().catch(() => ({}))) as { error?: string };
          alert(errData.error || 'Abmeldung fehgeschlagen.');
        }
      } catch (e) {
        console.error(e);
        alert('Netzwerkfehler bei der Abmeldung.');
      } finally {
        this.isSubmitting = false;
      }
    },

    async executeTogglePause(state: boolean): Promise<void> {
      this.isSubmitting = true;
      try {
        const res = await this._postApi('pause', { paused: state });
        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(errData.error || `HTTP Status ${res.status}`);
        }
      } catch (e) {
        const error = e as Error;
        this.handleError('Fehler beim Pausieren', error, () => this.executeTogglePause(state));
      } finally {
        this.isSubmitting = false;
      }
    },

    async triggerReadySetup(): Promise<void> {
      this.unlockSound();
      if (this.isPaused) {
        await this.executeTogglePause(false);
      }
      this.showStartSetup = false;
    },

    async requestWakeLock(): Promise<void> {
      if (window.gapFlowUtils) {
        await window.gapFlowUtils.requestWakeLock(this);
      }
    },

    unlockSound(): void {
      if (window.gapFlowAudio) {
        const ctx = window.gapFlowAudio.unlockAudioContext(this.audioContext);
        if (ctx) {
          this.audioContext = ctx;
          this.soundUnlocked = true;
        }
      }
      this.requestWakeLock();
    },
  };
}

window.examiner = examiner;
