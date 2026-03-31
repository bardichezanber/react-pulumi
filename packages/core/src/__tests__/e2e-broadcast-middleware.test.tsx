/**
 * E2E tests for Phase 2 core features:
 *   BroadcastMiddleware integrated with renderToPulumi via extraMiddlewares
 *   + VizInput/VizButton registration during render
 *
 * Tests the full flow: render → middleware pipeline (Persistence + ActionLog + Broadcast)
 * → events broadcast + action log persisted + viz controls registered.
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement, useCallback, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionLog } from "../middlewares/action-log-middleware.js";
import { BroadcastMiddleware } from "../middlewares/broadcast-middleware.js";
import { setPulumiSDK } from "../pulumi-bridge.js";
import { renderToPulumi } from "../render-to-pulumi.js";
import type { DeployOutcomeEvent, HydrateEvent } from "../state-middleware.js";
import { resetState } from "../state-store.js";
import { vizRegistry } from "../viz-registry.js";
import { pulumiToComponent } from "../wrap.js";
import { VizInput } from "../components/VizInput.js";
import { VizButton } from "../components/VizButton.js";

// ── Mock resources ──

class MockBucket {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly opts: Record<string, unknown>;
  constructor(name: string, args: Record<string, unknown>, opts?: Record<string, unknown>) {
    this.name = name;
    this.args = args;
    this.opts = opts ?? {};
  }
}
const [Bucket] = pulumiToComponent(MockBucket as never, "aws:s3:Bucket");

// ── Mock Pulumi SDK ──

function createMockPulumiSDK(configStore: Record<string, string> = {}) {
  const dynamicResources: Array<{ name: string; inputs: Record<string, unknown> }> = [];
  return {
    Config: class { private ns: string; constructor(ns: string) { this.ns = ns; } get(key: string) { return configStore[`${this.ns}:${key}`]; } },
    dynamic: { Resource: class { constructor(_p: unknown, name: string, inputs: Record<string, unknown>) { dynamicResources.push({ name, inputs }); } } },
    _dynamicResources: dynamicResources,
    _configStore: configStore,
  };
}

// ── Test helpers ──

let testDir: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  testDir = join(tmpdir(), `react-pulumi-broadcast-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(testDir);
  resetState();
  vizRegistry.reset();
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(testDir, { recursive: true, force: true });
  vizRegistry.reset();
});

function readActionLog(): ActionLog | null {
  const logPath = join(testDir, ".react-pulumi", "action-log.json");
  if (!existsSync(logPath)) return null;
  return JSON.parse(readFileSync(logPath, "utf-8")) as ActionLog;
}

// ── Tests ──

describe("E2E: BroadcastMiddleware with renderToPulumi", () => {
  it("extraMiddlewares receives same events as built-in middlewares", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    const broadcasted: string[] = [];
    const broadcast = new BroadcastMiddleware((data) => broadcasted.push(data));

    function App() {
      const [count] = useState(3);
      return createElement(Bucket, { name: `bucket-${count}` });
    }

    renderToPulumi(App, { extraMiddlewares: [broadcast] })();

    // Broadcast received events
    expect(broadcasted.length).toBeGreaterThanOrEqual(2); // hydrate + deploy_outcome
    const events = broadcasted.map((d) => JSON.parse(d));
    const types = events.map((e: { type: string }) => e.type);
    expect(types).toContain("state_event");
    expect(types).toContain("deploy_outcome");

    // Action log also has events (built-in middleware still works)
    const log = readActionLog()!;
    expect(log.events.length).toBeGreaterThanOrEqual(2);
  });

  it("replay buffer has complete history after render", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    const broadcast = new BroadcastMiddleware(() => {});

    function App() {
      const [a] = useState(1);
      const [b] = useState("hello");
      return createElement(Bucket, { name: `bucket-${a}-${b}` });
    }

    renderToPulumi(App, { extraMiddlewares: [broadcast] })();

    const buf = broadcast.getReplayBuffer();
    // At least 2 hydrate + 1 deploy_outcome
    expect(buf.length).toBeGreaterThanOrEqual(3);
    expect(buf.some((e) => e.type === "hydrate")).toBe(true);
    expect(buf.some((e) => e.type === "deploy_outcome")).toBe(true);
  });

  it("multi-run: replay buffer accumulates across deploys", () => {
    const configStore: Record<string, string> = {};
    const broadcast = new BroadcastMiddleware(() => {});

    // Run 1
    const sdk1 = createMockPulumiSDK(configStore);
    setPulumiSDK(sdk1);
    function App1() { const [c] = useState(1); return createElement(Bucket, { name: `b-${c}` }); }
    renderToPulumi(App1, { extraMiddlewares: [broadcast] })();
    configStore["react-pulumi:state"] = sdk1._dynamicResources[0].inputs.state as string;

    const bufAfterRun1 = broadcast.getReplayBuffer().length;

    // Run 2
    const sdk2 = createMockPulumiSDK(configStore);
    setPulumiSDK(sdk2);
    function App2() { const [c] = useState(1); return createElement(Bucket, { name: `b-${c}` }); }
    renderToPulumi(App2, { extraMiddlewares: [broadcast] })();

    // Buffer grew
    expect(broadcast.getReplayBuffer().length).toBeGreaterThan(bufAfterRun1);

    // Two deploy outcomes
    const outcomes = broadcast.getReplayBuffer().filter((e) => e.type === "deploy_outcome");
    expect(outcomes).toHaveLength(2);
  });

  it("broadcast failure does not break render or persistence", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    const throwBroadcast = new BroadcastMiddleware(() => { throw new Error("ws closed"); });

    function App() {
      const [count] = useState(5);
      return createElement(Bucket, { name: `bucket-${count}` });
    }

    // Should not throw
    renderToPulumi(App, { extraMiddlewares: [throwBroadcast] })();

    // Persistence still works
    expect(sdk._dynamicResources).toHaveLength(1);
    const state = JSON.parse(sdk._dynamicResources[0].inputs.state as string);
    expect(state.values[0]).toBe(5);

    // Action log still works
    const log = readActionLog()!;
    expect(log.events.length).toBeGreaterThan(0);
  });

  it("broadcast events have correct deployId matching deploy outcome", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    const broadcasted: string[] = [];
    const broadcast = new BroadcastMiddleware((data) => broadcasted.push(data));

    function App() {
      const [n] = useState(1);
      return createElement(Bucket, { name: `b-${n}` });
    }

    renderToPulumi(App, { extraMiddlewares: [broadcast] })();

    const events = broadcasted.map((d) => JSON.parse(d));
    const stateEvents = events.filter((e: { type: string }) => e.type === "state_event");
    const outcomeEvents = events.filter((e: { type: string }) => e.type === "deploy_outcome");

    expect(outcomeEvents).toHaveLength(1);
    const deployId = outcomeEvents[0].event.deployId;
    expect(deployId).toBeTruthy();

    // All state events should have the same deployId
    for (const se of stateEvents) {
      expect(se.event.deployId).toBe(deployId);
    }
  });
});

describe("E2E: VizInput/VizButton registration during renderToPulumi", () => {
  it("VizInput registers in vizRegistry during render", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    function App() {
      const [replicas, setReplicas] = useState(2);
      return createElement("div", null,
        createElement(VizInput, { name: "replicas", label: "Replicas", inputType: "number", value: replicas, setValue: setReplicas, min: 1, max: 10 }),
        createElement(Bucket, { name: `bucket-${replicas}` }),
      );
    }

    renderToPulumi(App)();

    const controls = vizRegistry.list();
    expect(controls.length).toBeGreaterThanOrEqual(1);
    const replicasCtrl = controls.find((c) => c.name === "replicas");
    expect(replicasCtrl).toBeDefined();
    expect(replicasCtrl!.controlType).toBe("input");
    expect(replicasCtrl!.inputType).toBe("number");
    expect(replicasCtrl!.min).toBe(1);
    expect(replicasCtrl!.max).toBe(10);
  });

  it("VizButton registers in vizRegistry during render", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    const handler = vi.fn();
    function App() {
      const [count] = useState(1);
      return createElement("div", null,
        createElement(VizButton, { name: "scale-up", label: "Scale Up", handler }),
        createElement(Bucket, { name: `bucket-${count}` }),
      );
    }

    renderToPulumi(App)();

    const controls = vizRegistry.list();
    const btn = controls.find((c) => c.name === "scale-up");
    expect(btn).toBeDefined();
    expect(btn!.controlType).toBe("button");
    expect(btn!.label).toBe("Scale Up");
  });

  it("vizRegistry.invoke calls registered handler", async () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    const handler = vi.fn();
    function App() {
      const [count] = useState(1);
      return createElement("div", null,
        createElement(VizButton, { name: "action", label: "Do It", handler }),
        createElement(Bucket, { name: `bucket-${count}` }),
      );
    }

    renderToPulumi(App)();

    await vizRegistry.invoke("action");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("VizInput + VizButton + BroadcastMiddleware all work together", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    const broadcasted: string[] = [];
    const broadcast = new BroadcastMiddleware((data) => broadcasted.push(data));
    const handler = vi.fn();

    function App() {
      const [replicas, setReplicas] = useState(3);
      return createElement("div", null,
        createElement(VizInput, { name: "replicas", inputType: "number", value: replicas, setValue: setReplicas }),
        createElement(VizButton, { name: "reset", label: "Reset", handler }),
        ...Array.from({ length: replicas }, (_, i) =>
          createElement(Bucket, { key: i, name: `bucket-${i}` }),
        ),
      );
    }

    renderToPulumi(App, { extraMiddlewares: [broadcast] })();

    // Broadcast received events
    expect(broadcasted.length).toBeGreaterThan(0);

    // VizControls registered
    const controls = vizRegistry.list();
    expect(controls.find((c) => c.name === "replicas")).toBeDefined();
    expect(controls.find((c) => c.name === "reset")).toBeDefined();

    // Action log persisted
    const log = readActionLog()!;
    expect(log).not.toBeNull();

    // State persisted
    expect(sdk._dynamicResources).toHaveLength(1);
  });
});
