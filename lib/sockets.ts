// Version Tracker: lib/sockets.ts (GAP-Flow v1.1.64)

import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { SystemState } from './types';
import { FlatExaminerState } from './state_filters';

/**
 * Erweitertes Socket-Interface zur Speicherung rollenspezifischer Metadaten.
 */
export interface AuthenticatedSocket extends Socket {
  role?: string;
  token?: string;
  deviceToken?: string | null;
}

/**
 * Funktions-Typen für die DSGVO-gefilterten State-Getter.
 */
export type GetBeamerStateFn = () => Record<string, unknown>;
export type GetFlatExaminerStateFn = (
  token: string,
  clientDeviceToken?: string | null
) => FlatExaminerState | Record<string, unknown> | null;
export type GetAdminStateFn = () => Record<string, unknown>;

let io: Server | null = null;

/**
 * Initialisiert den Socket.io-Server, konfiguriert die Handshake-Sicherheitsmiddleware
 * und verwaltet die Client-Verbindungen basierend auf rollenabhängigen WebSocket-Räumen.
 * @param {HttpServer} server - Der laufende Express HTTP-Server.
 * @param {SystemState} systemState - Der zentrale In-Memory-Systemzustand.
 * @param {string} adminPassword - Das aktive Administrationspasswort.
 * @param {function(): string} getAdminSessionToken - Funktion zur Ermittlung des Sitzungstokens.
 * @param {function(string): boolean} isValidExaminerToken - Verifizierung des Prüfer-Tokens.
 * @param {GetBeamerStateFn} getBeamerState - Getter für den Beamer-State.
 * @param {GetFlatExaminerStateFn} getFlatExaminerState - Getter für den Prüfer-State.
 * @param {GetAdminStateFn} getAdminDashboardState - Getter für das Dashboard.
 * @param {GetAdminStateFn} getAdminGroupsState - Getter für die Gruppenansicht.
 * @param {GetAdminStateFn} getAdminStationsState - Getter für die Stationsansicht.
 * @returns {Server} Die initialisierte Socket.io-Serverinstanz.
 */
export function init(
  server: HttpServer,
  systemState: SystemState,
  adminPassword: string,
  getAdminSessionToken: () => string,
  isValidExaminerToken: (token: string) => boolean,
  getBeamerState: GetBeamerStateFn,
  getFlatExaminerState: GetFlatExaminerStateFn,
  getAdminDashboardState: GetAdminStateFn,
  getAdminGroupsState: GetAdminStateFn,
  getAdminStationsState: GetAdminStateFn
): Server {
  io = new Server(server, {
    cors: { origin: '*' },
    transports: ['websocket', 'polling'],
    pingTimeout: 20000,
    pingInterval: 10000,
  });

  io.use((socket: AuthenticatedSocket, next) => {
    const auth = socket.handshake.auth || {};
    const role = auth.role as string | undefined;

    if (role === 'admin') {
      const page = (socket.handshake.auth.page as string) || 'dashboard';

      if (page === 'groups') {
        socket.join('room_admin_groups');
        socket.emit('stateUpdate', getAdminGroupsState());
      } else if (page === 'stations') {
        socket.join('room_admin_stations');
        socket.emit('stateUpdate', getAdminStationsState());
      } else {
        socket.join('room_admin_dashboard');
        socket.emit('stateUpdate', getAdminDashboardState());
      }
    } else if (role === 'beamer') {
      socket.join('room_beamer');
      socket.emit('stateUpdate', getBeamerState());
    } else if (role === 'examiner' && socket.token) {
      const token = socket.token;
      socket.join(`room_examiner_${token}`);
      socket.emit('stateUpdate', getFlatExaminerState(token, socket.deviceToken));
    }

    // Behandlung von mobilen Sprechwunsch-Anforderungen von Prüfstellen
    socket.on('requestCallback', (data: { target: 'leitstelle' | 'pruefungsleitung'; subId?: string; examinerName?: string; phoneNumber?: string }) => {
      if (socket.role !== 'examiner') return;

      const targetLabel = data.target === 'pruefungsleitung' ? 'PRÜFUNGSLEITUNG' : 'LEITSTELLE';
      const notificationData = {
        title: `🚨 Rückruf durch ${targetLabel}!`,
        body: `Station ${data.subId || 'unbekannt'} bittet um Rückruf.\nRückruf an folgende Nummer: ${data.phoneNumber || 'Keine Telefonnummer hinterlegt'}`,
        target: data.target,
        subId: data.subId,
        examinerName: data.examinerName,
        phoneNumber: data.phoneNumber,
        vibrate: [500, 150, 500, 150, 500, 300, 1000],
        timestamp: Date.now(),
      };

      io?.to('room_admin_dashboard').emit('callbackRequested', notificationData);
      io?.to('room_admin_stations').emit('callbackRequested', notificationData);
      io?.to('room_admin_groups').emit('callbackRequested', notificationData);
      io?.to('room_pruefungsleitung').emit('callbackRequested', notificationData);
      io?.to('room_leitstelle').emit('callbackRequested', notificationData);
    });
  });

  return io;
}

/**
 * Sendet gezielte, datenminimierte Updates an alle aktiven Client-Räume.
 * @param {SystemState} systemState - Der aktuelle Systemzustand im RAM.
 * @param {GetBeamerStateFn} getBeamerState - Getter für den Beamer-State.
 * @param {GetFlatExaminerStateFn} getFlatExaminerState - Getter für den Prüfer-State.
 * @param {GetAdminStateFn} getAdminDashboardState - Getter für das Dashboard.
 * @param {GetAdminStateFn} getAdminGroupsState - Getter für die Gruppenansicht.
 * @param {GetAdminStateFn} getAdminStationsState - Getter für die Stationsansicht.
 * @returns {void}
 */
export function broadcastState(
  systemState: SystemState,
  getBeamerState: GetBeamerStateFn,
  getFlatExaminerState: GetFlatExaminerStateFn,
  getAdminDashboardState: GetAdminStateFn,
  getAdminGroupsState: GetAdminStateFn,
  getAdminStationsState: GetAdminStateFn
): void {
  if (!io) return;

  io.to('room_admin_dashboard').emit('stateUpdate', getAdminDashboardState());
  io.to('room_admin_groups').emit('stateUpdate', getAdminGroupsState());
  io.to('room_admin_stations').emit('stateUpdate', getAdminStationsState());

  io.to('room_beamer').emit('stateUpdate', getBeamerState());

  Object.keys(systemState.stations || {}).forEach((mId) => {
    const master = systemState.stations[mId];
    if (master && master.subStations) {
      Object.keys(master.subStations).forEach((sId) => {
        const sub = master.subStations[sId];
        const token = sub.token;
        const roomKey = `room_examiner_${token}`;

        const socketsInRoom = io?.sockets.adapter.rooms.get(roomKey);
        if (socketsInRoom && socketsInRoom.size > 0) {
          for (const socketId of socketsInRoom) {
            const clientSocket = io?.sockets.sockets.get(socketId) as AuthenticatedSocket | undefined;
            if (clientSocket) {
              const examinerState = getFlatExaminerState(token, clientSocket.deviceToken);
              if (examinerState) {
                clientSocket.emit('stateUpdate', examinerState);
              }
            }
          }
        } else {
          const fallbackState = getFlatExaminerState(token, null);
          if (fallbackState) {
            io?.to(roomKey).emit('stateUpdate', fallbackState);
          }
        }
      });
    }
  });
}
