interface AdminSocketIoClient {
  disconnect: () => void;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
}

interface AdminPanelBase {
  authenticated: boolean;
  passwordInput: string;
  password: string;
  authError: boolean;
  isSubmitting: boolean;
  showInactivityWarning: boolean;
  inactivityWarningTimeout: ReturnType<typeof setTimeout> | null;
  inactivityLogoutTimeout: ReturnType<typeof setTimeout> | null;
  INACTIVITY_LIMIT_MS: number;
  WARNING_BUFFER_MS: number;
  _inactivityHandler?: EventListener | null;
  _tabSyncInterval?: ReturnType<typeof setInterval> | null;
  pageInit?: () => void;
  initSocket?: () => void;

  init(): void;
  logout(): void;
  startInactivityTimer(): void;
  resetInactivityTimer(isSyncOnly?: boolean): void;
  triggerInactivityWarning(): void;
  playWarningSound(): void;
  stopInactivityTimer(): void;
  login(): Promise<void>;
  verifyAndLoad(isToken?: boolean): void;
  fetchAdminStatus(): Promise<Record<string, unknown> | null>;
  toggleAutoAllocation(state: boolean): Promise<void>;
  exportCSV(): Promise<void>;
  connectSocket(stateUpdateCallback?: (state: Record<string, unknown>) => void): void;
}

(window as any).createAdminPanel = function (
  pageSpecificConfig: Record<string, unknown>
): AdminPanelBase & Record<string, unknown> {
  const basePanel: AdminPanelBase = {
    authenticated: false,
    passwordInput: '',
    password: '',
    authError: false,
    isSubmitting: false,
    showInactivityWarning: false,
    inactivityWarningTimeout: null,
    inactivityLogoutTimeout: null,
    INACTIVITY_LIMIT_MS: 15 * 60 * 1000,
    WARNING_BUFFER_MS: 60 * 1000,
    _inactivityHandler: null,
    _tabSyncInterval: null,

    init(): void {
      window.addEventListener('storage', (e: StorageEvent) => {
        if (e.key === 'admin_token' && !e.newValue && this.authenticated) {
          this.logout();
        }
      });

      const lastActivity = localStorage.getItem('admin_last_activity');
      const parsedActive = lastActivity ? parseInt(lastActivity, 10) : null;
      const elapsed = parsedActive && !Number.isNaN(parsedActive) ? Date.now() - parsedActive : Infinity;

      if (elapsed > this.INACTIVITY_LIMIT_MS) {
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_last_activity');
      }

      const storedToken = localStorage.getItem('admin_token');
      if (storedToken) {
        this.password = storedToken;
        this.verifyAndLoad(true);
      }

      if (this.pageInit) {
        this.pageInit();
      }
    },

    logout(): void {
      this.authenticated = false;
      this.password = '';
      this.passwordInput = '';
      this.authError = false;
      localStorage.removeItem('admin_token');
      localStorage.removeItem('admin_last_activity');
      this.stopInactivityTimer();

      if (this._inactivityHandler) {
        const events = ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart'];
        events.forEach((evt) => document.removeEventListener(evt, this._inactivityHandler!));
        this._inactivityHandler = null;
      }

      if (window.adminSocket) {
        window.adminSocket.disconnect();
        window.adminSocket = null;
      }
    },

    startInactivityTimer(): void {
      this.stopInactivityTimer();
      const events = ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart'];
      if (!this._inactivityHandler) {
        this._inactivityHandler = () => this.resetInactivityTimer();
      }
      events.forEach((evt) => document.addEventListener(evt, this._inactivityHandler!, { passive: true }));
      this.resetInactivityTimer();

      if (!this._tabSyncInterval) {
        this._tabSyncInterval = setInterval(() => {
          if (!this.authenticated) return;
          const lastActivity = localStorage.getItem('admin_last_activity');
          if (lastActivity) {
            const elapsed = Date.now() - parseInt(lastActivity, 10);
            if (elapsed < 60000) {
              this.resetInactivityTimer(true);
            }
          }
        }, 15000);
      }
    },

    resetInactivityTimer(isSyncOnly = false): void {
      if (this.showInactivityWarning) {
        this.showInactivityWarning = false;
      }
      if (this.inactivityWarningTimeout) clearTimeout(this.inactivityWarningTimeout);
      if (this.inactivityLogoutTimeout) clearTimeout(this.inactivityLogoutTimeout);

      if (this.authenticated && !isSyncOnly) {
        localStorage.setItem('admin_last_activity', Date.now().toString());
      }

      const warningDelay = this.INACTIVITY_LIMIT_MS - this.WARNING_BUFFER_MS;

      this.inactivityWarningTimeout = setTimeout(() => {
        if (this.authenticated) {
          this.triggerInactivityWarning();
        }
      }, warningDelay);
    },

    triggerInactivityWarning(): void {
      this.showInactivityWarning = true;
      this.playWarningSound();

      this.inactivityLogoutTimeout = setTimeout(() => {
        if (this.authenticated) {
          this.logout();
        }
      }, this.WARNING_BUFFER_MS);
    },

    playWarningSound(): void {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        const ctx = new AudioContextClass();

        const playTone = (freq: number, duration: number, delay: number) => {
          const osc = ctx.createOscillator();
          const gainNode = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
          gainNode.gain.setValueAtTime(0.4, ctx.currentTime + delay);
          gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + duration);
          osc.connect(gainNode);
          gainNode.connect(ctx.destination);
          osc.start(ctx.currentTime + delay);
          osc.stop(ctx.currentTime + delay + duration);
        };

        playTone(880, 0.12, 0);
        playTone(880, 0.12, 0.2);
      } catch (e) {
        console.warn('Warnton blockiert:', e);
      }
    },

    stopInactivityTimer(): void {
      if (this.inactivityWarningTimeout) {
        clearTimeout(this.inactivityWarningTimeout);
        this.inactivityWarningTimeout = null;
      }
      if (this.inactivityLogoutTimeout) {
        clearTimeout(this.inactivityLogoutTimeout);
        this.inactivityLogoutTimeout = null;
      }
      if (this._tabSyncInterval) {
        clearInterval(this._tabSyncInterval);
        this._tabSyncInterval = null;
      }
      this.showInactivityWarning = false;
      if (this._inactivityHandler) {
        const events = ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart'];
        events.forEach((evt) => document.removeEventListener(evt, this._inactivityHandler!));
        this._inactivityHandler = null;
      }
    },

    async login(): Promise<void> {
      this.password = this.passwordInput;
      this.verifyAndLoad(false);
    },

    verifyAndLoad(isToken = false): void {
      if (isToken && !this.password) {
        this.password = localStorage.getItem('admin_token') || '';
      }

      let endpoint = '/api/admin/verify';
      let payload: Record<string, string> = { password: this.password };

      if (isToken) {
        endpoint = '/api/admin/verify_token';
        payload = { token: this.password };
      }

      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then((res) => {
          if (res.ok) {
            return res.json() as Promise<{ token?: string }>;
          }
          if (res.status === 429) {
            alert('Sicherheits-Sperre aktiv: Zu viele Anfragen von dieser IP-Adresse. Bitte warten Sie einen Moment, bevor Sie es erneut versuchen.');
          } else {
            this.authError = true;
            localStorage.removeItem('admin_token');
            this.authenticated = false;
          }
          return null;
        })
        .then((data) => {
          if (!data) return;
          this.authenticated = true;
          this.authError = false;

          if (data.token) {
            localStorage.setItem('admin_token', data.token);
            this.password = data.token;
          }

          localStorage.setItem('admin_last_activity', Date.now().toString());
          this.startInactivityTimer();

          if (this.initSocket) {
            this.initSocket();
          }
        })
        .catch((e) => {
          console.error(e);
        });
    },

    /**
     * Lädt den Zustand der Admin-Ansicht direkt per HTTP REST-API (Fallback & Initialer Sofortload).
     * @returns {Promise<Record<string, unknown> | null>} Geladener Zustand oder null bei Fehler.
     */
    async fetchAdminStatus(): Promise<Record<string, unknown> | null> {
      let pageContext = 'dashboard';
      const path = window.location.pathname;
      if (path.includes('admin_groups.html')) {
        pageContext = 'groups';
      } else if (path.includes('admin_stations.html')) {
        pageContext = 'stations';
      }

      try {
        const res = await fetch(`/api/admin/${pageContext}/status`, {
          headers: { Authorization: this.password },
        });
        if (res.ok) {
          return (await res.json()) as Record<string, unknown>;
        }
      } catch (e) {
        console.error('REST-API Status-Laden fehlgeschlagen:', e);
      }
      return null;
    },

    async toggleAutoAllocation(state: boolean): Promise<void> {
      if (this.isSubmitting) return;
      this.isSubmitting = true;
      try {
        const response = await fetch('/api/admin/toggle_auto_allocation', {
          method: 'PUT',
          headers: {
            Authorization: this.password,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ active: state }),
        });
        if (!response.ok) {
          throw new Error(`HTTP Status ${response.status}`);
        }
      } catch (e) {
        console.error(e);
        alert('Netzwerk-Fehler: Der Startschuss konnte nicht übertragen werden. Bitte Verbindung prüfen.');
      } finally {
        this.isSubmitting = false;
      }
    },

    async exportCSV(): Promise<void> {
      try {
        const response = await fetch('/api/admin/export', {
          method: 'GET',
          headers: { Authorization: this.password },
        });

        if (window.gapFlowUtils) {
          const success = await window.gapFlowUtils.downloadFileFromResponse(response, 'pruefungs_protokoll.csv');
          if (!success) {
            alert('Export fehlgeschlagen: Nicht autorisiert oder ungültige Serverrückmeldung.');
          }
        }
      } catch (e) {
        console.error(e);
        alert('Netzwerk-Fehler beim Exportieren.');
      }
    },

    connectSocket(stateUpdateCallback?: (state: Record<string, unknown>) => void): void {
      try {
        if (window.adminSocket) {
          window.adminSocket.disconnect();
        }

        let pageContext = 'dashboard';
        const path = window.location.pathname;
        if (path.includes('admin_groups.html')) {
          pageContext = 'groups';
        } else if (path.includes('admin_stations.html')) {
          pageContext = 'stations';
        } else if (path.includes('admin_settings.html')) {
          pageContext = 'settings';
        }

        if (typeof window.io === 'function') {
          window.adminSocket = window.io({
            auth: { role: 'admin', token: this.password, page: pageContext },
          });

          if (stateUpdateCallback) {
            window.adminSocket.on('stateUpdate', (...args: unknown[]) => {
              if (args[0] && typeof args[0] === 'object') {
                stateUpdateCallback(args[0] as Record<string, unknown>);
              }
            });
          }
        }
      } catch (e) {
        console.error('Socket.io nicht erreichbar:', e);
      }
    },
  };

  return Object.defineProperties(basePanel, Object.getOwnPropertyDescriptors(pageSpecificConfig)) as AdminPanelBase &
    Record<string, unknown>;
};
