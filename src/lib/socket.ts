import { io, type Socket } from "socket.io-client";
import { API_ORIGIN, getToken } from "./http";

/**
 * One Socket.IO connection per panel tab, authenticated as the signed-in admin.
 * The server's handshake reads `auth.token` + `auth.userType`; see
 * Backend/services/socketService.js for the event contract used below.
 */
let socket: Socket | null = null;

export function getSocket(): Socket | null {
  const token = getToken();
  if (!token) return null;
  if (socket && (socket.auth as { token?: string }).token !== token) {
    socket.disconnect();
    socket = null;
  }
  if (!socket) {
    socket = io(API_ORIGIN, {
      auth: { token, userType: "admin" },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });
  } else if (!socket.connected) {
    socket.connect();
  }
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

/* ---- payloads the server emits ---- */
export type ChatUpdate = {
  chatId: string;
  userId?: string;
  lastMessage?: string;
  unreadCount?: number;
  lastMessageTime?: string;
  assignedAdmin?: unknown;
};
export type TypingEvent = { chatId: string; userId: string; userName: string; userType: "user" | "admin" };
export type PresenceEvent = { chatId: string; userId: string; userName?: string; online: boolean; lastSeen?: string };
export type DeletedEvent = { messageId: string; chatId: string };
