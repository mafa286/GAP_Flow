interface StationGroup {
  id: string;
  name: string;
  active?: boolean;
  completedStations: string[];
  currentStation: string | null;
}

interface PopupSubStation {
  id: string;
  parentId: string;
  examiner: string;
  paused: boolean;
  currentGroupId: string | null;
  reservedGroupId?: string | null;
}

interface PopupMasterStation {
  id: string;
  name: string;
  active: boolean;
  subStations: Record<string, PopupSubStation>;
}

interface AdminStationsPopupsComponent {
  popupMasterId: string;
  popupSubId: string;
  popupManualAssignGroupId: string;
  showManualAssignPopup: boolean;
  popupExaminerName: string;
  showExaminerPopup: boolean;
  popupReservationGroupId: string;
  showReservationPopup: boolean;
  popupAddLogGroupId: string;
  showAddLogPopup: boolean;
  popupRevertLogGroupId: string;
  showRevertLogPopup: boolean;
  isSubmitting: boolean;
  password: string;
  groups: Record<string, StationGroup>;
  stations: Record<string, PopupMasterStation>;
  [key: string]: any;

  setPopupSubStation(masterId: string, subId: string): void;
  openManualAssignPopup(masterId: string, subId: string): void;
  getGroupName(groupId: string): string;
  getAvailableGroupsForManualAssign(): StationGroup[];
  getAvailableGroupsForSubStation(masterId: string, sub: PopupSubStation): StationGroup[];
  saveManualAssignPopup(): Promise<void>;
  releaseSub(id: string, subId: string): Promise<void>;
  _updateSubConfig(masterId: string, subId: string, payload: Record<string, unknown>, errorLabel: string, modalPropToHide?: string): Promise<void>;
  removeExaminer(masterId: string, subId: string): Promise<void>;
  openExaminerPopup(masterId: string, subId: string, currentExaminer: string): void;
  saveExaminerPopup(): Promise<void>;
  openReservationPopup(masterId: string, subId: string): void;
  getReservationGroups(): StationGroup[];
  saveReservationPopup(): Promise<void>;
  removeReservation(masterId: string, subId: string): Promise<void>;
  openAddLogPopup(masterId: string, subId: string): void;
  getAddLogGroups(): StationGroup[];
  _saveCorrectionsPopup(endpoint: 'complete' | 'revert', groupId: string, modalPropToHide: string, errorLabel: string): Promise<void>;
  saveAddLogPopup(): Promise<void>;
  openRevertLogPopup(masterId: string, subId: string): void;
  getRevertLogGroups(): StationGroup[];
  saveRevertLogPopup(): Promise<void>;
  completeSub(id: string, subId: string): Promise<void>;
}

window.adminStationsPopups = {
  /**
   * Setzt die aktuelle Master- und Unterstations-ID für Popups.
   * @param {string} masterId - ID der Hauptstation.
   * @param {string} subId - ID der Unterstation.
   * @returns {void}
   */
  setPopupSubStation(masterId: string, subId: string): void {
    const self = this as unknown as AdminStationsPopupsComponent;
    self.popupMasterId = masterId;
    self.popupSubId = subId;
  },

  /**
   * Öffnet das Popup zur manuellen Gruppenzuweisung.
   * @param {string} masterId - ID der Hauptstation.
   * @param {string} subId - ID der Unterstation.
   * @returns {void}
   */
  openManualAssignPopup(masterId: string, subId: string): void {
    const self = this as unknown as AdminStationsPopupsComponent;
    self.setPopupSubStation(masterId, subId);
    self.popupManualAssignGroupId = '';
    self.showManualAssignPopup = true;
  },

  /**
   * Ermittelt den Namen einer Gruppe anhand ihrer ID.
   * @param {string} groupId - Gruppen-ID.
   * @returns {string} Gruppenname oder leere Zeichenkette.
   */
  getGroupName(groupId: string): string {
    const self = this as unknown as AdminStationsPopupsComponent;
    if (!groupId || !self.groups || !self.groups[groupId]) return '';
    return self.groups[groupId].name || '';
  },

  getAvailableGroupsForManualAssign(): StationGroup[] {
    const self = this as unknown as AdminStationsPopupsComponent;
    if (!self.popupMasterId || !self.popupSubId || !self.stations || !self.stations[self.popupMasterId]) return [];
    const sub = self.stations[self.popupMasterId].subStations?.[self.popupSubId];
    if (!sub) return [];
    return self.getAvailableGroupsForSubStation(self.popupMasterId, sub);
  },

  async saveManualAssignPopup(): Promise<void> {
    const self = this as unknown as AdminStationsPopupsComponent;
    if (self.isSubmitting) return;
    if (!self.popupManualAssignGroupId) return;
    self.isSubmitting = true;
    try {
      const response = await fetch(`/api/admin/stations/${self.popupMasterId}/sub_assign`, {
        method: 'PUT',
        headers: { Authorization: self.password, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subId: self.popupSubId, groupId: self.popupManualAssignGroupId }),
      });
      if (!response.ok) {
        const errData = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error || `HTTP Status ${response.status}`);
      }
      self.showManualAssignPopup = false;
    } catch (e) {
      const error = e as Error;
      console.error(error);
      alert(`Fehler bei manueller Zuweisung: ${error.message}`);
    } finally {
      self.isSubmitting = false;
    }
  },

  async releaseSub(id: string, subId: string): Promise<void> {
    const self = this as unknown as AdminStationsPopupsComponent;
    if (self.isSubmitting) return;
    const sub = self.stations[id]?.subStations?.[subId];
    const groupName =
      sub && sub.currentGroupId && self.groups[sub.currentGroupId]
        ? self.groups[sub.currentGroupId].name
        : 'dieser Gruppe';
    if (
      !confirm(
        `Möchten Sie die Zuweisung für "${groupName}" an Unterstation ${subId} wirklich zurücknehmen und das Team im Sammelraum parken?`
      )
    ) {
      return;
    }
    self.isSubmitting = true;
    try {
      const response = await fetch(`/api/admin/stations/${id}/sub_release`, {
        method: 'PUT',
        headers: { Authorization: self.password, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subId }),
      });
      if (!response.ok) {
        const errData = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error || `HTTP Status ${response.status}`);
      }
    } catch (e) {
      const error = e as Error;
      console.error(error);
      alert(`Fehler bei Freigabe: ${error.message}`);
    } finally {
      self.isSubmitting = false;
    }
  },

  async _updateSubConfig(
    masterId: string,
    subId: string,
    payload: Record<string, unknown>,
    errorLabel: string,
    modalPropToHide?: string
  ): Promise<void> {
    const self = this as unknown as AdminStationsPopupsComponent;
    self.isSubmitting = true;
    try {
      const response = await fetch(`/api/admin/stations/${masterId}/sub_config`, {
        method: 'PUT',
        headers: { Authorization: self.password, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subId, ...payload }),
      });
      if (!response.ok) {
        const errData = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error || `HTTP Status ${response.status}`);
      }
      if (modalPropToHide && modalPropToHide in self) {
        (self as unknown as Record<string, unknown>)[modalPropToHide] = false;
      }
    } catch (e) {
      const error = e as Error;
      console.error(error);
      alert(`Fehler bei ${errorLabel}: ${error.message}`);
    } finally {
      self.isSubmitting = false;
    }
  },

  async removeExaminer(masterId: string, subId: string): Promise<void> {
    if (!confirm('Möchten Sie den Prüfer dieser Unterstation wirklich entfernen? Das verbundene Gerät wird sofort abgemeldet.')) return;
    return this._updateSubConfig(masterId, subId, { examiner: '', deviceToken: null }, 'Entfernen des Prüfers');
  },

  openExaminerPopup(masterId: string, subId: string, currentExaminer: string): void {
    const self = this as unknown as AdminStationsPopupsComponent;
    self.setPopupSubStation(masterId, subId);
    self.popupExaminerName = currentExaminer;
    self.showExaminerPopup = true;
  },

  async saveExaminerPopup(): Promise<void> {
    const self = this as unknown as AdminStationsPopupsComponent;
    return this._updateSubConfig(self.popupMasterId, self.popupSubId, { examiner: self.popupExaminerName }, 'Speichern des Prüfers', 'showExaminerPopup');
  },

  openReservationPopup(masterId: string, subId: string): void {
    const self = this as unknown as AdminStationsPopupsComponent;
    self.setPopupSubStation(masterId, subId);
    const sub = self.stations[masterId]?.subStations[subId];
    self.popupReservationGroupId = sub ? sub.reservedGroupId || '' : '';
    self.showReservationPopup = true;
  },

  getReservationGroups(): StationGroup[] {
    const self = this as unknown as AdminStationsPopupsComponent;
    if (!self.popupMasterId) return [];
    return Object.values(self.groups || {}).filter((g) => {
      const notCompleted = !(g.completedStations || []).includes(self.popupMasterId);
      const isAssignedToThisMaster =
        g.currentStation && g.currentStation.split('.')[0] === self.popupMasterId;
      return notCompleted && !isAssignedToThisMaster;
    });
  },

  async saveReservationPopup(): Promise<void> {
    const self = this as unknown as AdminStationsPopupsComponent;
    if (!self.popupReservationGroupId) return;
    return this._updateSubConfig(self.popupMasterId, self.popupSubId, { reservedGroupId: self.popupReservationGroupId }, 'Folgegruppen-Zuweisung', 'showReservationPopup');
  },

  async removeReservation(masterId: string, subId: string): Promise<void> {
    if (!confirm('Möchten Sie die Folgegruppen-Vormerkung für diese Station wirklich aufheben?')) return;
    return this._updateSubConfig(masterId, subId, { reservedGroupId: null }, 'Aufheben der Folgegruppe');
  },

  openAddLogPopup(masterId: string, subId: string): void {
    const self = this as unknown as AdminStationsPopupsComponent;
    self.setPopupSubStation(masterId, subId);
    self.popupAddLogGroupId = '';
    self.showAddLogPopup = true;
  },

  getAddLogGroups(): StationGroup[] {
    const self = this as unknown as AdminStationsPopupsComponent;
    if (!self.popupMasterId) return [];
    return Object.values(self.groups || {}).filter((g) => {
      const isActive = g.active !== false;
      const notCompleted = !(g.completedStations || []).includes(self.popupMasterId);
      const isAssignedToThisMaster =
        g.currentStation && g.currentStation.split('.')[0] === self.popupMasterId;
      return isActive && notCompleted && !isAssignedToThisMaster;
    });
  },

  async _saveCorrectionsPopup(
    endpoint: 'complete' | 'revert',
    groupId: string,
    modalPropToHide: string,
    errorLabel: string
  ): Promise<void> {
    const self = this as unknown as AdminStationsPopupsComponent;
    if (!groupId) return;
    self.isSubmitting = true;
    try {
      const response = await fetch(`/api/admin/corrections/${endpoint}`, {
        method: 'POST',
        headers: { Authorization: self.password, 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, stationId: self.popupMasterId }),
      });
      if (!response.ok) {
        const errData = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error || `HTTP Status ${response.status}`);
      }
      (self as unknown as Record<string, unknown>)[modalPropToHide] = false;
    } catch (e) {
      const error = e as Error;
      console.error(error);
      alert(`Fehler bei ${errorLabel}: ${error.message}`);
    } finally {
      self.isSubmitting = false;
    }
  },

  async saveAddLogPopup(): Promise<void> {
    const self = this as unknown as AdminStationsPopupsComponent;
    return this._saveCorrectionsPopup('complete', self.popupAddLogGroupId, 'showAddLogPopup', 'Rückmeldung hinzufügen');
  },

  openRevertLogPopup(masterId: string, subId: string): void {
    const self = this as unknown as AdminStationsPopupsComponent;
    self.setPopupSubStation(masterId, subId);
    self.popupRevertLogGroupId = '';
    self.showRevertLogPopup = true;
  },

  getRevertLogGroups(): StationGroup[] {
    const self = this as unknown as AdminStationsPopupsComponent;
    if (!self.popupMasterId) return [];
    return Object.values(self.groups || {}).filter(
      (g) => g.active !== false && (g.completedStations || []).includes(self.popupMasterId)
    );
  },

  async saveRevertLogPopup(): Promise<void> {
    const self = this as unknown as AdminStationsPopupsComponent;
    return this._saveCorrectionsPopup('revert', self.popupRevertLogGroupId, 'showRevertLogPopup', 'Rückmeldung stornieren');
  },

  async completeSub(id: string, subId: string): Promise<void> {
    const self = this as unknown as AdminStationsPopupsComponent;
    if (self.isSubmitting) return;
    const sub = self.stations[id]?.subStations[subId];
    const groupName =
      sub && sub.currentGroupId && self.groups[sub.currentGroupId]
        ? self.groups[sub.currentGroupId].name
        : 'dieser Gruppe';

    if (!confirm(`Möchten Sie die Prüfung für "${groupName}" wirklich über den Admin-Leitstand abschließen?`)) {
      return;
    }

    self.isSubmitting = true;
    try {
      const response = await fetch(`/api/admin/stations/${id}/sub_complete`, {
        method: 'PUT',
        headers: {
          Authorization: self.password,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ subId }),
      });
      if (!response.ok) {
        throw new Error(`HTTP Status ${response.status}`);
      }
    } catch (e) {
      console.error(e);
      alert('Netzwerk-Fehler: Die Prüfung konnte nicht abgeschlossen werden. Bitte Verbindung prüfen.');
    } finally {
      self.isSubmitting = false;
    }
  },
};
