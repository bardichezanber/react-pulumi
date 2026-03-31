/**
 * Tests for the WebSocket server module.
 * Creates a real HTTP server + WebSocket, connects a ws client, verifies replay + broadcast.
 */

import { createServer, type Server as HttpServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { BroadcastMiddleware } from "@react-pulumi/core/middlewares";
import type { HydrateEvent, DeployOutcomeEvent } from "@react-pulumi/core";
import { createWsServer, type WsBroadcaster } from "../ws-server.js";

let httpServer: HttpServer;
let wsBroadcaster: WsBroadcaster;
let port: number;

function makeHydrate(index: number, value: unknown): HydrateEvent {
  return { type: "hydrate", index, value, defaultValue: 0, seq: index, timestamp: Date.now(), deployId: "test" };
}

function makeOutcome(): DeployOutcomeEvent {
  return { type: "deploy_outcome", deployId: "test", success: true, stateSnapshot: { keys: ["App:0"], values: [1] }, keyMap: { 0: "App:0" }, seq: 99, timestamp: Date.now() };
}

/** Connect a WS client and collect all messages until a condition is met */
function collectMessages(count: number, timeoutMs = 3000): Promise<string[]> {
  return new Promise((resolve) => {
    const messages: string[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const timer = setTimeout(() => { ws.close(); resolve(messages); }, timeoutMs);

    ws.on("message", (data) => {
      messages.push(data.toString());
      if (messages.length >= count) {
        clearTimeout(timer);
        ws.close();
        resolve(messages);
      }
    });

    ws.on("error", () => { clearTimeout(timer); resolve(messages); });
  });
}

beforeEach(async () => {
  httpServer = createServer();
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  port = (httpServer.address() as { port: number }).port;
});

afterEach(async () => {
  wsBroadcaster?.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe("ws-server", () => {
  it("sends replay_complete on new connection (no history)", async () => {
    const broadcastMw = new BroadcastMiddleware(() => {});
    wsBroadcaster = createWsServer({ httpServer, broadcastMiddleware: broadcastMw });

    const messages = await collectMessages(1);
    expect(messages).toHaveLength(1);
    expect(JSON.parse(messages[0]).type).toBe("replay_complete");
  });

  it("replays buffered events to new client", async () => {
    const broadcastMw = new BroadcastMiddleware(() => {});
    broadcastMw.onStateChange(makeHydrate(0, 42));
    broadcastMw.onDeployOutcome(makeOutcome());

    wsBroadcaster = createWsServer({ httpServer, broadcastMiddleware: broadcastMw });

    // 2 replay events + 1 replay_complete = 3
    const messages = await collectMessages(3);
    const parsed = messages.map((m) => JSON.parse(m));

    expect(parsed).toHaveLength(3);
    expect(parsed[0].type).toBe("state_event");
    expect(parsed[0].event.value).toBe(42);
    expect(parsed[1].type).toBe("deploy_outcome");
    expect(parsed[2].type).toBe("replay_complete");
  });

  it("broadcast sends to all connected clients", async () => {
    const broadcastMw = new BroadcastMiddleware(() => {});
    wsBroadcaster = createWsServer({ httpServer, broadcastMiddleware: broadcastMw });

    // Connect two clients, wait for replay_complete on each
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await Promise.all([
      new Promise<void>((r) => ws1.on("message", () => r())),
      new Promise<void>((r) => ws2.on("message", () => r())),
    ]);

    // Now listen for broadcast
    const p1 = new Promise<string>((r) => ws1.on("message", (d) => r(d.toString())));
    const p2 = new Promise<string>((r) => ws2.on("message", (d) => r(d.toString())));

    wsBroadcaster.broadcast({ type: "status_update", status: "deploying" });

    const [m1, m2] = await Promise.all([p1, p2]);
    ws1.close();
    ws2.close();

    expect(JSON.parse(m1).type).toBe("status_update");
    expect(JSON.parse(m2).type).toBe("status_update");
  });

  it("clientCount reflects connected clients", async () => {
    const broadcastMw = new BroadcastMiddleware(() => {});
    wsBroadcaster = createWsServer({ httpServer, broadcastMiddleware: broadcastMw });

    expect(wsBroadcaster.clientCount).toBe(0);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((r) => ws.on("open", r));
    expect(wsBroadcaster.clientCount).toBe(1);

    ws.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(wsBroadcaster.clientCount).toBe(0);
  });
});
