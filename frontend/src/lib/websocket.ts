import type { WSMessage, WSClientMessage } from "@/types";
import { getAccessToken } from "./api";

type MessageHandler = (msg: WSMessage) => void;
type StatusHandler  = (connected: boolean) => void;

export class CadsaWebSocket {
  private ws:              WebSocket | null = null;
  private handlers:        MessageHandler[] = [];
  private statusHandlers:  StatusHandler[]  = [];
  private reconnectTimer:  ReturnType<typeof setTimeout> | null = null;
  // Deferred initial-connect timer — lets StrictMode's synchronous unmount
  // cancel before any WebSocket object is ever created (eliminating the
  // "closed before established" console error in development).
  private pendingConnect:  ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private shouldReconnect = true;
  private pingInterval:   ReturnType<typeof setInterval> | null = null;

  connect(): void {
    this.shouldReconnect = true;
    // Skip if already open/connecting
    const state = this.ws?.readyState;
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;
    // Skip if a connect is already scheduled
    if (this.pendingConnect) return;
    // Defer by one tick so React StrictMode's synchronous unmount can cancel
    // this before the socket is created.
    this.pendingConnect = setTimeout(() => {
      this.pendingConnect = null;
      if (this.shouldReconnect) this._connect();
    }, 0);
  }

  private _connect(): void {
    const token = getAccessToken();
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url   = `${proto}://${window.location.host}/api/v1/ws/realtime?token=${token}`;

    // Capture this specific socket instance so closures don't accidentally
    // operate on a later socket if this one is replaced.
    const ws = new WebSocket(url);
    this.ws  = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;  // stale socket — a newer one took over
      this.reconnectDelay = 1000;
      this._notifyStatus(true);
      this._startPing();
    };

    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      try {
        const msg: WSMessage = JSON.parse(ev.data);
        if (msg.type === "ping") {
          this.send({ type: "pong" });
          return;
        }
        this.handlers.forEach((h) => h(msg));
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;  // stale — don't trigger reconnect for old sockets
      this._notifyStatus(false);
      this._stopPing();
      if (this.shouldReconnect) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
          this._connect();
        }, this.reconnectDelay);
      }
    };

    ws.onerror = () => {
      if (this.ws !== ws) return;  // stale
      ws.close();
    };
  }

  send(msg: WSClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;

    // Cancel a pending (deferred) connect — socket was never created yet.
    if (this.pendingConnect) {
      clearTimeout(this.pendingConnect);
      this.pendingConnect = null;
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._stopPing();

    if (this.ws) {
      // Null all handlers before closing so no delayed events (onerror/onclose)
      // fire after we've intentionally torn down the connection.
      this.ws.onopen    = null;
      this.ws.onmessage = null;
      this.ws.onclose   = null;
      this.ws.onerror   = null;
      this.ws.close();
      this.ws = null;
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.push(handler);
    return () => {
      this.statusHandlers = this.statusHandlers.filter((h) => h !== handler);
    };
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private _notifyStatus(connected: boolean): void {
    this.statusHandlers.forEach((h) => h(connected));
  }

  private _startPing(): void {
    this.pingInterval = setInterval(() => {
      this.send({ type: "pong" });
    }, 25_000);
  }

  private _stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}

export const wsClient = new CadsaWebSocket();
