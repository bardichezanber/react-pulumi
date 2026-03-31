/**
 * WebSocket server module — attaches to the existing HTTP server via upgrade.
 * Handles replay on new client connect and broadcast to all clients.
 */

import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { BroadcastMiddleware } from "@react-pulumi/core/middlewares";
import type { ServerMessage } from "@react-pulumi/core";

export interface WsServerOptions {
  httpServer: HttpServer;
  broadcastMiddleware?: BroadcastMiddleware;
}

export interface WsBroadcaster {
  broadcast(msg: ServerMessage): void;
  broadcastRaw(data: string): void;
  close(): void;
  readonly clientCount: number;
}

export function createWsServer(opts: WsServerOptions): WsBroadcaster {
  const wss = new WebSocketServer({ server: opts.httpServer, path: "/ws" });

  function sendRaw(ws: WebSocket, data: string): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  }

  // On new connection: replay buffered events, then send replay_complete
  wss.on("connection", (ws: WebSocket) => {
    if (opts.broadcastMiddleware) {
      const buffer = opts.broadcastMiddleware.getReplayBuffer();
      for (const event of buffer) {
        const msgType = event.type === "deploy_outcome" ? "deploy_outcome" : "state_event";
        sendRaw(ws, JSON.stringify({ type: msgType, event }));
      }
    }
    sendRaw(ws, JSON.stringify({ type: "replay_complete" }));
  });

  return {
    broadcast(msg: ServerMessage): void {
      const data = JSON.stringify(msg);
      for (const client of wss.clients) {
        sendRaw(client as WebSocket, data);
      }
    },

    broadcastRaw(data: string): void {
      for (const client of wss.clients) {
        sendRaw(client as WebSocket, data);
      }
    },

    close(): void {
      wss.close();
    },

    get clientCount(): number {
      return wss.clients.size;
    },
  };
}
