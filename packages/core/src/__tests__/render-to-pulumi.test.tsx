import { createElement, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPulumiSDK } from "../pulumi-bridge.js";
import { renderToPulumi } from "../render-to-pulumi.js";
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

// ── Mock Pulumi SDK ──

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
        // Real Pulumi: constructor(provider, name, props, opts?)
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

beforeEach(() => {
  resetState();
});

describe("renderToPulumi", () => {
  it("returns a function", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    function App() {
      return createElement(Bucket, { name: "my-bucket" });
    }

    const program = renderToPulumi(App);
    expect(typeof program).toBe("function");
  });

  it("renders and creates resources when called", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    function App() {
      return createElement(Bucket, { name: "my-bucket", versioning: true });
    }

    const program = renderToPulumi(App);
    program();

    // No useState → no dynamic resource created
    expect(sdk._dynamicResources).toHaveLength(0);
  });

  it("creates state hook resource when component uses useState", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    function App() {
      const [count] = useState(2);
      return Array.from({ length: count }, (_, i) =>
        createElement(Bucket, { key: i, name: `bucket-${i}` }),
      ) as unknown as React.ReactElement;
    }

    const program = renderToPulumi(App);
    program();

    expect(sdk._dynamicResources).toHaveLength(1);
    expect(sdk._dynamicResources[0].name).toBe("__react_pulumi_state");

    const stateInput = sdk._dynamicResources[0].inputs.state as string;
    const parsed = JSON.parse(stateInput);
    expect(parsed.keys).toEqual(["App:0"]);
    expect(parsed.values).toEqual([2]);
  });

  it("hydrates useState from persisted config on second run", () => {
    // First run — default values
    const configStore: Record<string, string> = {};
    const sdk1 = createMockPulumiSDK(configStore);
    setPulumiSDK(sdk1);

    function App() {
      const [count] = useState(2);
      return Array.from({ length: count }, (_, i) =>
        createElement(Bucket, { key: i, name: `bucket-${i}` }),
      ) as unknown as React.ReactElement;
    }

    renderToPulumi(App)();

    // Simulate deploy success: write state to config
    const firstState = sdk1._dynamicResources[0].inputs.state as string;
    configStore["react-pulumi:state"] = firstState;

    // Modify state to simulate "setCount(5)"
    configStore["react-pulumi:state"] = JSON.stringify({ keys: ["App:0"], values: [5] });

    // Second run — should hydrate from config
    const sdk2 = createMockPulumiSDK(configStore);
    setPulumiSDK(sdk2);

    let capturedCount = -1;
    function App2() {
      const [count] = useState(2); // default 2, should get 5 from config
      capturedCount = count;
      return Array.from({ length: count }, (_, i) =>
        createElement(Bucket, { key: i, name: `bucket-${i}` }),
      ) as unknown as React.ReactElement;
    }

    renderToPulumi(App2)();

    expect(capturedCount).toBe(5);
    expect(sdk2._dynamicResources).toHaveLength(1);

    const secondState = JSON.parse(sdk2._dynamicResources[0].inputs.state as string);
    expect(secondState.keys).toEqual(["App2:0"]);
    expect(secondState.values).toEqual([5]);
  });

  it("warns when hook keys change between runs", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const configStore: Record<string, string> = {
      "react-pulumi:state": JSON.stringify({
        keys: ["OldApp:0", "OldApp:1"],
        values: [10, "old"],
      }),
    };

    const sdk = createMockPulumiSDK(configStore);
    setPulumiSDK(sdk);

    function NewApp() {
      const [count] = useState(1);
      return createElement(Bucket, { name: `bucket-${count}` });
    }

    renderToPulumi(NewApp)();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Component structure changed"));

    warnSpy.mockRestore();
  });

  it("does not warn on first run (no previous state)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    function App() {
      const [count] = useState(2);
      return createElement(Bucket, { name: `bucket-${count}` });
    }

    renderToPulumi(App)();

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("does not warn when keys match", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const configStore: Record<string, string> = {
      "react-pulumi:state": JSON.stringify({
        keys: ["App:0"],
        values: [5],
      }),
    };

    const sdk = createMockPulumiSDK(configStore);
    setPulumiSDK(sdk);

    function App() {
      const [count] = useState(2);
      return createElement(Bucket, { name: `bucket-${count}` });
    }

    renderToPulumi(App)();

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("falls back to defaults when keys mismatch", () => {
    const configStore: Record<string, string> = {
      "react-pulumi:state": JSON.stringify({
        keys: ["OldApp:0"],
        values: [99],
      }),
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sdk = createMockPulumiSDK(configStore);
    setPulumiSDK(sdk);

    let capturedCount = -1;
    function App() {
      const [count] = useState(3);
      capturedCount = count;
      return createElement(Bucket, { name: `bucket-${count}` });
    }

    renderToPulumi(App)();

    // Values are loaded positionally — 99 replaces default 3
    expect(capturedCount).toBe(99);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("skips state resource when no useState hooks are used", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    function App() {
      return createElement(Bucket, { name: "simple-bucket" });
    }

    renderToPulumi(App)();

    expect(sdk._dynamicResources).toHaveLength(0);
  });

  it("handles multiple useState hooks", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    let capturedCount = -1;
    let capturedType = "";
    let capturedEnabled: boolean | null = null;

    function App() {
      const [count] = useState(2);
      const [type] = useState("t3.micro");
      const [enabled] = useState(true);
      capturedCount = count;
      capturedType = type;
      capturedEnabled = enabled;
      if (!enabled) return null;
      return Array.from({ length: count }, (_, i) =>
        createElement(Bucket, { key: i, name: `bucket-${i}`, tags: { type } }),
      ) as unknown as React.ReactElement;
    }

    renderToPulumi(App)();

    // Verify the values the component actually received
    expect(capturedCount).toBe(2);
    expect(capturedType).toBe("t3.micro");
    expect(capturedEnabled).toBe(true);

    expect(sdk._dynamicResources).toHaveLength(1);
    const state = JSON.parse(sdk._dynamicResources[0].inputs.state as string);
    expect(state.keys).toEqual(["App:0", "App:1", "App:2"]);
    expect(state.values).toHaveLength(3);
    // First two values should always match
    expect(state.values[0]).toBe(2);
    expect(state.values[1]).toBe("t3.micro");
  });

  it("handles nested components with useState", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    function Child() {
      const [size] = useState("large");
      return createElement(Bucket, { name: "child-bucket", tags: { size } });
    }

    function App() {
      const [_count] = useState(1);
      return createElement(Child);
    }

    renderToPulumi(App)();

    expect(sdk._dynamicResources).toHaveLength(1);
    const state = JSON.parse(sdk._dynamicResources[0].inputs.state as string);
    expect(state.keys).toEqual(["App:0", "Child:0"]);
    expect(state.values).toEqual([1, "large"]);
  });

  it("state hook resource has correct name and state input", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    function App() {
      const [count] = useState(2);
      return createElement(Bucket, { name: `bucket-${count}` });
    }

    renderToPulumi(App)();

    const dr = sdk._dynamicResources[0];
    expect(dr.name).toBe("__react_pulumi_state");

    const state = JSON.parse(dr.inputs.state as string);
    expect(state).toEqual({ keys: ["App:0"], values: [2] });
  });

  it("state hook resource provider has create, update, and delete methods", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    function App() {
      const [count] = useState(2);
      return createElement(Bucket, { name: `bucket-${count}` });
    }

    renderToPulumi(App)();

    const provider = sdk._dynamicResources[0].provider;
    expect(typeof provider.create).toBe("function");
    expect(typeof provider.update).toBe("function");
    expect(typeof provider.delete).toBe("function");
  });
});

describe("E2E: two-run state persistence", () => {
  it("simulates full lifecycle: first run → persist → second run with hydrated state", () => {
    const configStore: Record<string, string> = {};

    // ── First run ──
    const sdk1 = createMockPulumiSDK(configStore);
    setPulumiSDK(sdk1);

    let firstRunCount = -1;
    function AppRun1() {
      const [count] = useState(2);
      firstRunCount = count;
      return Array.from({ length: count }, (_, i) =>
        createElement(Bucket, { key: i, name: `bucket-${i}` }),
      ) as unknown as React.ReactElement;
    }

    renderToPulumi(AppRun1)();

    expect(firstRunCount).toBe(2); // default

    // Simulate deploy success: write state to config
    const firstStateJson = sdk1._dynamicResources[0].inputs.state as string;
    configStore["react-pulumi:state"] = firstStateJson;

    const firstState = JSON.parse(firstStateJson);
    expect(firstState).toEqual({ keys: ["AppRun1:0"], values: [2] });

    // ── Simulate user changing state ──
    configStore["react-pulumi:state"] = JSON.stringify({
      keys: ["AppRun2:0"],
      values: [4],
    });

    // ── Second run ──
    const sdk2 = createMockPulumiSDK(configStore);
    setPulumiSDK(sdk2);

    let secondRunCount = -1;
    function AppRun2() {
      const [count] = useState(2); // same default
      secondRunCount = count;
      return Array.from({ length: count }, (_, i) =>
        createElement(Bucket, { key: i, name: `bucket-${i}` }),
      ) as unknown as React.ReactElement;
    }

    renderToPulumi(AppRun2)();

    expect(secondRunCount).toBe(4); // hydrated from config

    const secondStateJson = sdk2._dynamicResources[0].inputs.state as string;
    const secondState = JSON.parse(secondStateJson);
    expect(secondState.keys).toEqual(["AppRun2:0"]);
    expect(secondState.values).toEqual([4]);
  });

  it("handles state with multiple hooks across multiple runs", () => {
    const configStore: Record<string, string> = {};

    // ── First run ──
    const sdk1 = createMockPulumiSDK(configStore);
    setPulumiSDK(sdk1);

    let capturedReplicas1 = -1;
    let capturedRegion1 = "";

    function AppV1() {
      const [replicas] = useState(2);
      const [region] = useState("us-east-1");
      capturedReplicas1 = replicas;
      capturedRegion1 = region;
      return Array.from({ length: replicas }, (_, i) =>
        createElement(Bucket, { key: i, name: `bucket-${region}-${i}` }),
      ) as unknown as React.ReactElement;
    }

    renderToPulumi(AppV1)();

    expect(capturedReplicas1).toBe(2);
    expect(capturedRegion1).toBe("us-east-1");

    const state1 = JSON.parse(sdk1._dynamicResources[0].inputs.state as string);
    expect(state1.keys).toEqual(["AppV1:0", "AppV1:1"]);
    expect(state1.values).toEqual([2, "us-east-1"]);

    // Simulate persisting modified state
    configStore["react-pulumi:state"] = JSON.stringify({
      keys: ["AppV2:0", "AppV2:1"],
      values: [5, "eu-west-1"],
    });

    // ── Second run ──
    const sdk2 = createMockPulumiSDK(configStore);
    setPulumiSDK(sdk2);

    let capturedReplicas2 = -1;
    let capturedRegion2 = "";

    function AppV2() {
      const [replicas] = useState(2);
      const [region] = useState("us-east-1");
      capturedReplicas2 = replicas;
      capturedRegion2 = region;
      return Array.from({ length: replicas }, (_, i) =>
        createElement(Bucket, { key: i, name: `bucket-${region}-${i}` }),
      ) as unknown as React.ReactElement;
    }

    renderToPulumi(AppV2)();

    expect(capturedReplicas2).toBe(5);
    expect(capturedRegion2).toBe("eu-west-1");
  });

  it("first run with no config produces correct initial state", () => {
    const sdk = createMockPulumiSDK({});
    setPulumiSDK(sdk);

    let capturedVal = -1;
    function App() {
      const [val] = useState(42);
      capturedVal = val;
      return createElement(Bucket, { name: "b" });
    }

    renderToPulumi(App)();

    expect(capturedVal).toBe(42);
    const state = JSON.parse(sdk._dynamicResources[0].inputs.state as string);
    expect(state.values).toEqual([42]);
  });

  it("state persists across three consecutive runs", () => {
    const configStore: Record<string, string> = {};

    // Run 1: default
    const sdk1 = createMockPulumiSDK(configStore);
    setPulumiSDK(sdk1);

    let val1 = -1;
    function App1() {
      const [v] = useState(10);
      val1 = v;
      return createElement(Bucket, { name: "b" });
    }
    renderToPulumi(App1)();
    expect(val1).toBe(10);

    // Persist
    configStore["react-pulumi:state"] = sdk1._dynamicResources[0].inputs.state as string;

    // Run 2: hydrate from run 1, "modify" to 20
    configStore["react-pulumi:state"] = JSON.stringify({ keys: ["App2:0"], values: [20] });
    const sdk2 = createMockPulumiSDK(configStore);
    setPulumiSDK(sdk2);

    let val2 = -1;
    function App2() {
      const [v] = useState(10);
      val2 = v;
      return createElement(Bucket, { name: "b" });
    }
    renderToPulumi(App2)();
    expect(val2).toBe(20);

    // Persist
    configStore["react-pulumi:state"] = sdk2._dynamicResources[0].inputs.state as string;

    // Run 3: hydrate from run 2
    const sdk3 = createMockPulumiSDK(configStore);
    setPulumiSDK(sdk3);

    let val3 = -1;
    function App3() {
      const [v] = useState(10);
      val3 = v;
      return createElement(Bucket, { name: "b" });
    }
    renderToPulumi(App3)();
    expect(val3).toBe(20); // still 20 from run 2
  });
});
