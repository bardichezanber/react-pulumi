/**
 * E2E tests for the middleware pipeline integrated with renderToPulumi.
 *
 * Tests the full flow: render → hydrate events → collect state → deploy outcome → action log flush.
 * Uses mock Pulumi SDK (no cloud resources needed) and a temp directory for action log isolation.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionLog } from "../middlewares/action-log-middleware.js";
import { setPulumiSDK } from "../pulumi-bridge.js";
import { renderToPulumi } from "../render-to-pulumi.js";
import type { DeployOutcomeEvent, HydrateEvent } from "../state-middleware.js";
import { resetState } from "../state-store.js";
import { pulumiToComponent } from "../wrap.js";

// ── Mock Pulumi resource ──

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

// ── Mock Pulumi SDK (identical pattern to render-to-pulumi.test.tsx) ──

function createMockPulumiSDK(configStore: Record<string, string> = {}) {
  const dynamicResources: Array<{
    name: string;
    provider: Record<string, unknown>;
    inputs: Record<string, unknown>;
  }> = [];

  const sdk = {
    Config: class MockConfig {
      private ns: string;
      constructor(ns: string) {
        this.ns = ns;
      }
      get(key: string): string | undefined {
        return configStore[`${this.ns}:${key}`];
      }
    },
    dynamic: {
      Resource: class MockDynamicResource {
        constructor(provider: unknown, name: string, inputs: Record<string, unknown>) {
          dynamicResources.push({
            name,
            provider: provider as Record<string, unknown>,
            inputs,
          });
        }
      },
    },
    _dynamicResources: dynamicResources,
    _configStore: configStore,
  };

  return sdk;
}

// ── Test helpers ──

let testDir: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `react-pulumi-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(testDir);
  resetState();
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(testDir, { recursive: true, force: true });
});

function readActionLog(): ActionLog | null {
  const logPath = join(testDir, ".react-pulumi", "action-log.json");
  if (!existsSync(logPath)) return null;
  return JSON.parse(readFileSync(logPath, "utf-8")) as ActionLog;
}

// ── Tests ──

describe("E2E: middleware pipeline with renderToPulumi", () => {
  it("creates action log file on single run", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    function App() {
      const [count] = useState(2);
      return createElement(Bucket, { name: `bucket-${count}` });
    }

    renderToPulumi(App)();

    const log = readActionLog();
    expect(log).not.toBeNull();
    expect(log!.version).toBe(1);
    expect(log!.events.length).toBeGreaterThan(0);
  });

  it("records hydrate events and deploy outcome", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    function App() {
      const [count] = useState(2);
      const [region] = useState("us-east-1");
      return createElement(Bucket, { name: `bucket-${count}-${region}` });
    }

    renderToPulumi(App)();

    const log = readActionLog()!;
    const hydrateEvents = log.events.filter((e) => e.type === "hydrate");
    const deployOutcomes = log.events.filter((e) => e.type === "deploy_outcome");

    // At least 2 hydrate events (App's 2 useStates; pulumiToComponent may add more)
    expect(hydrateEvents.length).toBeGreaterThanOrEqual(2);
    expect(deployOutcomes).toHaveLength(1);
  });

  it("deploy outcome has correct keyMap and stateSnapshot", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    function App() {
      const [count] = useState(2);
      const [label] = useState("prod");
      return createElement(Bucket, { name: `bucket-${count}-${label}` });
    }

    renderToPulumi(App)();

    const log = readActionLog()!;
    const outcome = log.events.find((e) => e.type === "deploy_outcome") as DeployOutcomeEvent;

    expect(outcome.success).toBe(true);
    expect(outcome.deployId).toBeTruthy();

    // keyMap should map at least index 0 and 1 to App's hooks
    expect(outcome.keyMap[0]).toBe("App:0");
    expect(outcome.keyMap[1]).toBe("App:1");

    // stateSnapshot should match
    expect(outcome.stateSnapshot.keys).toContain("App:0");
    expect(outcome.stateSnapshot.keys).toContain("App:1");
    expect(outcome.stateSnapshot.values[0]).toBe(2);
    expect(outcome.stateSnapshot.values[1]).toBe("prod");
  });

  it("accumulates events across multiple runs with different deployIds", () => {
    const configStore: Record<string, string> = {};

    // ── Run 1 ──
    const sdk1 = createMockPulumiSDK(configStore);
    setPulumiSDK(sdk1);

    function AppRun1() {
      const [count] = useState(2);
      return createElement(Bucket, { name: `bucket-${count}` });
    }

    renderToPulumi(AppRun1)();

    // Simulate deploy success
    configStore["react-pulumi:state"] = sdk1._dynamicResources[0].inputs.state as string;

    const logAfterRun1 = readActionLog()!;
    const run1Outcomes = logAfterRun1.events.filter((e) => e.type === "deploy_outcome");
    expect(run1Outcomes).toHaveLength(1);
    const run1DeployId = (run1Outcomes[0] as DeployOutcomeEvent).deployId;

    // ── Run 2 ──
    const sdk2 = createMockPulumiSDK(configStore);
    setPulumiSDK(sdk2);

    function AppRun2() {
      const [count] = useState(2);
      return createElement(Bucket, { name: `bucket-${count}` });
    }

    renderToPulumi(AppRun2)();

    const logAfterRun2 = readActionLog()!;
    const allOutcomes = logAfterRun2.events.filter(
      (e) => e.type === "deploy_outcome",
    ) as DeployOutcomeEvent[];

    // Both runs' events accumulated
    expect(allOutcomes).toHaveLength(2);
    expect(allOutcomes[0].deployId).toBe(run1DeployId);
    expect(allOutcomes[1].deployId).not.toBe(run1DeployId); // Different deployId
  });

  it("action log shows hydrated values (not defaults) on second run", () => {
    const configStore: Record<string, string> = {};

    // ── Run 1 ──
    const sdk1 = createMockPulumiSDK(configStore);
    setPulumiSDK(sdk1);

    function AppRun1() {
      const [count] = useState(2);
      return createElement(Bucket, { name: `bucket-${count}` });
    }

    renderToPulumi(AppRun1)();

    // Simulate modified state after deploy
    configStore["react-pulumi:state"] = JSON.stringify({
      keys: ["AppRun2:0"],
      values: [5],
    });

    // ── Run 2 ──
    const sdk2 = createMockPulumiSDK(configStore);
    setPulumiSDK(sdk2);

    let capturedCount = -1;
    function AppRun2() {
      const [count] = useState(2); // default 2, should hydrate to 5
      capturedCount = count;
      return createElement(Bucket, { name: `bucket-${count}` });
    }

    renderToPulumi(AppRun2)();

    expect(capturedCount).toBe(5); // Hydrated from config

    // Check action log — Run 2's hydrate events should show value=5, defaultValue=2
    const log = readActionLog()!;
    const allOutcomes = log.events.filter((e) => e.type === "deploy_outcome") as DeployOutcomeEvent[];
    const run2DeployId = allOutcomes[allOutcomes.length - 1].deployId;

    const run2Hydrates = log.events.filter(
      (e) => e.type === "hydrate" && e.deployId === run2DeployId,
    ) as HydrateEvent[];

    // Find the App's hydrate event (index 0)
    const appHydrate = run2Hydrates.find((e) => e.index === 0);
    expect(appHydrate).toBeDefined();
    expect(appHydrate!.value).toBe(5); // hydrated value
    expect(appHydrate!.defaultValue).toBe(2); // original default
  });

  it("records hydrate events for nested components", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    function Child() {
      const [size] = useState("large");
      return createElement(Bucket, { name: `child-${size}` });
    }

    function App() {
      const [count] = useState(1);
      return createElement(Child, null);
    }

    renderToPulumi(App)();

    const log = readActionLog()!;
    const outcome = log.events.find((e) => e.type === "deploy_outcome") as DeployOutcomeEvent;

    // Both App:0 and Child:0 should be in the keyMap
    const keyValues = Object.values(outcome.keyMap);
    expect(keyValues).toContain("App:0");
    expect(keyValues).toContain("Child:0");

    // State snapshot has both values
    expect(outcome.stateSnapshot.values).toContain(1);
    expect(outcome.stateSnapshot.values).toContain("large");
  });

  it("creates action log with only deploy_outcome when no useState", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    function App() {
      return createElement(Bucket, { name: "simple-bucket" });
    }

    renderToPulumi(App)();

    const log = readActionLog()!;
    const hydrateEvents = log.events.filter((e) => e.type === "hydrate");
    const outcomes = log.events.filter((e) => e.type === "deploy_outcome") as DeployOutcomeEvent[];

    expect(hydrateEvents).toHaveLength(0);
    expect(outcomes).toHaveLength(1);
    expect(Object.keys(outcomes[0].keyMap)).toHaveLength(0);
    expect(outcomes[0].stateSnapshot.keys).toHaveLength(0);
  });

  it("recovers from corrupt action log file", () => {
    // Write garbage to the action log before running
    const logDir = join(testDir, ".react-pulumi");
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, "action-log.json"), "{{NOT VALID JSON!!", "utf-8");

    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    function App() {
      const [count] = useState(3);
      return createElement(Bucket, { name: `bucket-${count}` });
    }

    // Should not throw
    renderToPulumi(App)();

    // Action log should be overwritten with valid data
    const log = readActionLog()!;
    expect(log.version).toBe(1);
    expect(log.events.length).toBeGreaterThan(0);

    // Only current run's events (corrupt history discarded)
    const outcomes = log.events.filter((e) => e.type === "deploy_outcome");
    expect(outcomes).toHaveLength(1);
  });
});
