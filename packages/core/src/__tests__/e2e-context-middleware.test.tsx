/**
 * E2E tests combining Context wiring + middleware pipeline.
 *
 * These tests verify the full real-world flow:
 *   Multi-layer resource tree (Vcn → Subnet → Instance) with Context
 *   + useState for configuration
 *   + middleware pipeline (action log events, hydrate values, deploy outcomes)
 *
 * This is the "integration of integrations" — ensuring Context-based
 * resource wiring and the middleware event pipeline work together.
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement, useContext, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionLog } from "../middlewares/action-log-middleware.js";
import { setPulumiSDK } from "../pulumi-bridge.js";
import { renderToPulumi } from "../render-to-pulumi.js";
import type { DeployOutcomeEvent, HydrateEvent } from "../state-middleware.js";
import { resetState } from "../state-store.js";
import { pulumiToComponent } from "../wrap.js";

// ── Tracking infrastructure (same pattern as e2e-context.test.tsx) ──

interface TrackedResource {
  type: string;
  name: string;
  args: Record<string, unknown>;
}

const created: TrackedResource[] = [];

function resetTracking() {
  created.length = 0;
}

function makeTrackedClass(typeToken: string, fields: Record<string, unknown> = {}) {
  class Tracked {
    static __pulumiType = typeToken;
    readonly name: string;
    readonly args: Record<string, unknown>;
    readonly opts: Record<string, unknown>;
    constructor(name: string, args: Record<string, unknown>, opts?: Record<string, unknown>) {
      this.name = name;
      this.args = args;
      this.opts = opts ?? {};
      Object.assign(this, fields);
      created.push({ type: typeToken, name, args });
    }
  }
  for (const [k, v] of Object.entries(fields)) {
    Object.defineProperty(Tracked.prototype, k, { value: v, writable: true });
  }
  return Tracked;
}

// ── Mock Pulumi SDK ──

function createMockPulumiSDK(configStore: Record<string, string> = {}) {
  const dynamicResources: Array<{
    name: string;
    inputs: Record<string, unknown>;
  }> = [];

  return {
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
        constructor(_provider: unknown, name: string, inputs: Record<string, unknown>) {
          dynamicResources.push({ name, inputs });
        }
      },
    },
    _dynamicResources: dynamicResources,
    _configStore: configStore,
  };
}

// ── Resource classes ──

const VcnClass = makeTrackedClass("oci:core:Vcn", { id: "vcn-001", cidrBlock: "10.0.0.0/16" });
const SubnetClass = makeTrackedClass("oci:core:Subnet", { id: "subnet-001" });
const InstanceClass = makeTrackedClass("oci:core:Instance", { id: "inst-001" });

const [Vcn, VcnCtx] = pulumiToComponent(VcnClass as never);
const [Subnet, _SubnetCtx] = pulumiToComponent(SubnetClass as never);
const [Instance] = pulumiToComponent(InstanceClass as never);

// ── Test helpers ──

let testDir: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `react-pulumi-ctx-mw-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(testDir);
  resetState();
  resetTracking();
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

describe("E2E: Context wiring + middleware pipeline", () => {
  it("multi-layer tree with useState: resources created AND events logged", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    function SubnetLayer() {
      const vcn = useContext(VcnCtx);
      return createElement(Subnet, {
        name: "pub",
        vcnId: (vcn as any).id,
        cidrBlock: "10.0.0.0/20",
      });
    }

    function App() {
      const [replicas] = useState(2);
      return createElement(
        Vcn,
        { name: "main", cidrBlock: "10.0.0.0/16" },
        createElement(SubnetLayer),
        ...Array.from({ length: replicas }, (_, i) =>
          createElement(Instance, { key: `inst-${i}`, name: `web-${i}`, subnetId: "subnet-001" }),
        ),
      );
    }

    renderToPulumi(App)();

    // Resources created correctly via Context wiring
    expect(created.find((r) => r.type === "oci:core:Vcn")?.name).toBe("main");
    expect(created.find((r) => r.type === "oci:core:Subnet")?.args.vcnId).toBe("vcn-001");
    expect(created.filter((r) => r.type === "oci:core:Instance")).toHaveLength(2);

    // Action log has events from the middleware pipeline
    const log = readActionLog()!;
    expect(log).not.toBeNull();

    const hydrateEvents = log.events.filter((e) => e.type === "hydrate") as HydrateEvent[];
    // At least App's useState(2)
    expect(hydrateEvents.length).toBeGreaterThanOrEqual(1);
    expect(hydrateEvents[0].value).toBe(2);
    expect(hydrateEvents[0].defaultValue).toBe(2);

    const outcomes = log.events.filter((e) => e.type === "deploy_outcome") as DeployOutcomeEvent[];
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].success).toBe(true);
  });

  it("two-run lifecycle: Context + hydrated state + accumulated action log", () => {
    const configStore: Record<string, string> = {};

    // ── Run 1: default replicas=2 ──
    const sdk1 = createMockPulumiSDK(configStore);
    setPulumiSDK(sdk1);

    function SubnetLayer1() {
      const vcn = useContext(VcnCtx);
      return createElement(Subnet, { name: "pub", vcnId: (vcn as any).id });
    }

    function AppRun1() {
      const [replicas] = useState(2);
      return createElement(
        Vcn,
        { name: "main", cidrBlock: "10.0.0.0/16" },
        createElement(SubnetLayer1),
        ...Array.from({ length: replicas }, (_, i) =>
          createElement(Instance, { key: `inst-${i}`, name: `web-${i}` }),
        ),
      );
    }

    renderToPulumi(AppRun1)();

    expect(created.filter((r) => r.type === "oci:core:Instance")).toHaveLength(2);

    // Simulate deploy success: persist state + bump replicas to 4
    configStore["react-pulumi:state"] = JSON.stringify({
      keys: ["AppRun2:0"],
      values: [4],
    });

    // ── Run 2: hydrated replicas=4 ──
    resetTracking();

    const sdk2 = createMockPulumiSDK(configStore);
    setPulumiSDK(sdk2);

    function SubnetLayer2() {
      const vcn = useContext(VcnCtx);
      return createElement(Subnet, { name: "pub", vcnId: (vcn as any).id });
    }

    let capturedReplicas = -1;
    function AppRun2() {
      const [replicas] = useState(2); // default 2, hydrated to 4
      capturedReplicas = replicas;
      return createElement(
        Vcn,
        { name: "main", cidrBlock: "10.0.0.0/16" },
        createElement(SubnetLayer2),
        ...Array.from({ length: replicas }, (_, i) =>
          createElement(Instance, { key: `inst-${i}`, name: `web-${i}` }),
        ),
      );
    }

    renderToPulumi(AppRun2)();

    // Hydrated: 4 instances instead of 2
    expect(capturedReplicas).toBe(4);
    expect(created.filter((r) => r.type === "oci:core:Instance")).toHaveLength(4);

    // Context still works: Subnet reads Vcn.id
    expect(created.find((r) => r.type === "oci:core:Subnet")?.args.vcnId).toBe("vcn-001");

    // Action log accumulated across both runs
    const log = readActionLog()!;
    const outcomes = log.events.filter((e) => e.type === "deploy_outcome") as DeployOutcomeEvent[];
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0].deployId).not.toBe(outcomes[1].deployId);

    // Run 2's hydrate event shows hydrated value
    const run2DeployId = outcomes[1].deployId;
    const run2Hydrates = log.events.filter(
      (e) => e.type === "hydrate" && e.deployId === run2DeployId,
    ) as HydrateEvent[];
    const appHydrate = run2Hydrates.find((e) => e.index === 0);
    expect(appHydrate?.value).toBe(4); // hydrated
    expect(appHydrate?.defaultValue).toBe(2); // original default
  });

  it("render props + Context + middleware: full wiring", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    function App() {
      const [region] = useState("us-east-1");
      return createElement(Vcn, { name: "main", cidrBlock: "10.0.0.0/16", region }, (vcn: any) =>
        createElement(
          Subnet,
          { name: "pub", vcnId: vcn.id, cidrBlock: "10.0.0.0/20" },
          (subnet: any) => createElement(Instance, { name: "web-0", subnetId: subnet.id }),
        ),
      );
    }

    renderToPulumi(App)();

    // Resources created with render props wiring
    expect(created).toHaveLength(3);
    expect(created[0].type).toBe("oci:core:Vcn");
    expect(created[1].type).toBe("oci:core:Subnet");
    expect(created[1].args.vcnId).toBe("vcn-001");
    expect(created[2].type).toBe("oci:core:Instance");
    expect(created[2].args.subnetId).toBe("subnet-001");

    // Middleware recorded the render
    const log = readActionLog()!;
    const outcomes = log.events.filter((e) => e.type === "deploy_outcome") as DeployOutcomeEvent[];
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].stateSnapshot.values).toContain("us-east-1");
  });

  it("multiple useStates across nested components: all tracked in action log", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    function InfraConfig() {
      const vcn = useContext(VcnCtx);
      const [size] = useState("t3.micro");
      return createElement(Instance, { name: "web-0", instanceType: size, vcnId: (vcn as any).id });
    }

    function App() {
      const [_replicas] = useState(3);
      const [cidr] = useState("10.0.0.0/16");
      return createElement(Vcn, { name: "main", cidrBlock: cidr }, createElement(InfraConfig));
    }

    renderToPulumi(App)();

    // Resources created
    expect(created.find((r) => r.type === "oci:core:Vcn")?.args.cidrBlock).toBe("10.0.0.0/16");
    expect(created.find((r) => r.type === "oci:core:Instance")?.args.instanceType).toBe("t3.micro");
    expect(created.find((r) => r.type === "oci:core:Instance")?.args.vcnId).toBe("vcn-001");

    // Deploy outcome captures useState keys from both App and InfraConfig
    const log = readActionLog()!;
    const outcome = log.events.find((e) => e.type === "deploy_outcome") as DeployOutcomeEvent;
    const keyValues = Object.values(outcome.keyMap);
    expect(keyValues).toContain("App:0");
    expect(keyValues).toContain("App:1");
    expect(keyValues).toContain("InfraConfig:0");

    // State snapshot: App:0 = replicas (3) is verifiable
    const keys = outcome.stateSnapshot.keys;
    const values = outcome.stateSnapshot.values;
    const appIdx0 = keys.indexOf("App:0");
    expect(values[appIdx0]).toBe(3);
    // InfraConfig:0 exists in keys (value may be offset by internal hooks)
    expect(keys).toContain("InfraConfig:0");
  });

  it("conditional rendering: Context + middleware work when branch changes across runs", () => {
    const configStore: Record<string, string> = {};

    // ── Run 1: enabled=false → no Instance ──
    const sdk1 = createMockPulumiSDK(configStore);
    setPulumiSDK(sdk1);

    function AppRun1() {
      const [enabled] = useState(false);
      return createElement(
        Vcn,
        { name: "main", cidrBlock: "10.0.0.0/16" },
        enabled ? createElement(Instance, { name: "web-0", vcnId: "vcn-001" }) : null,
      );
    }

    renderToPulumi(AppRun1)();

    expect(created.filter((r) => r.type === "oci:core:Instance")).toHaveLength(0);
    expect(created.filter((r) => r.type === "oci:core:Vcn")).toHaveLength(1);

    // Simulate deploy: flip enabled to true
    configStore["react-pulumi:state"] = JSON.stringify({
      keys: ["AppRun2:0"],
      values: [true],
    });

    // ── Run 2: enabled=true → Instance created ──
    resetTracking();
    const sdk2 = createMockPulumiSDK(configStore);
    setPulumiSDK(sdk2);

    function AppRun2() {
      const [enabled] = useState(false); // default false, hydrated to true
      return createElement(
        Vcn,
        { name: "main", cidrBlock: "10.0.0.0/16" },
        enabled ? createElement(Instance, { name: "web-0", vcnId: "vcn-001" }) : null,
      );
    }

    renderToPulumi(AppRun2)();

    expect(created.filter((r) => r.type === "oci:core:Instance")).toHaveLength(1);

    // Action log shows the boolean flip
    const log = readActionLog()!;
    const outcomes = log.events.filter((e) => e.type === "deploy_outcome") as DeployOutcomeEvent[];
    expect(outcomes).toHaveLength(2);

    // Run 1: enabled=false
    expect(outcomes[0].stateSnapshot.values[0]).toBe(false);
    // Run 2: enabled=true (hydrated)
    expect(outcomes[1].stateSnapshot.values[0]).toBe(true);
  });
});
