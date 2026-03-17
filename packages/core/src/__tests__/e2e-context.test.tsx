/**
 * E2E tests for pulumiToComponent [Component, Context] feature.
 *
 * These tests go through the full renderToPulumi pipeline:
 *   loadState → interceptor → render (resources created) → collectHookKeys → state persistence
 *
 * They verify that Context-based cross-resource wiring, render props,
 * and nested scoping all work correctly within a real Pulumi program lifecycle.
 */

import { createElement, useContext, useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { setPulumiSDK } from "../pulumi-bridge.js";
import { renderToPulumi } from "../render-to-pulumi.js";
import { resetState } from "../state-store.js";
import { pulumiToComponent } from "../wrap.js";

// ── Tracking infrastructure ──

interface TrackedResource {
  type: string;
  name: string;
  args: Record<string, unknown>;
  opts: Record<string, unknown>;
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
      created.push({ type: typeToken, name, args, opts: this.opts });
    }
  }
  // Assign dynamic instance fields so they're accessible via useContext
  for (const [k, v] of Object.entries(fields)) {
    Object.defineProperty(Tracked.prototype, k, { value: v, writable: true });
  }
  return Tracked;
}

// ── Mock Pulumi SDK ──

function createMockPulumiSDK(configStore: Record<string, string> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dynamicResources: any[] = [];

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
        constructor(provider: unknown, name: string, inputs: Record<string, unknown>) {
          dynamicResources.push({ name, provider, inputs });
        }
      },
    },
    _dynamicResources: dynamicResources,
    _configStore: configStore,
  };
}

// ── Resource classes with mock Output-like fields ──

const VcnClass = makeTrackedClass("e2e:core:Vcn", { id: "vcn-001", cidrBlock: "10.0.0.0/16" });
const SubnetClass = makeTrackedClass("e2e:core:Subnet", { id: "subnet-001" });
const InstanceClass = makeTrackedClass("e2e:core:Instance", { id: "inst-001" });
const SecurityGroupClass = makeTrackedClass("e2e:core:SecurityGroup", { id: "sg-001" });

const [Vcn, VcnCtx] = pulumiToComponent(VcnClass as never);
const [Subnet, SubnetCtx] = pulumiToComponent(SubnetClass as never);
const [Instance] = pulumiToComponent(InstanceClass as never);
const [SecurityGroup, SGCtx] = pulumiToComponent(SecurityGroupClass as never);

beforeEach(() => {
  resetState();
  resetTracking();
});

// ─────────────────────────────────────────────────────────────
// E2E: Context mode — useContext reads ancestor instance
// ─────────────────────────────────────────────────────────────
describe("E2E: Context mode through renderToPulumi", () => {
  it("multi-layer Context wiring: Vcn → Subnet → Instance", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    function SubnetLayer() {
      const vcn = useContext(VcnCtx);
      return createElement(
        Subnet,
        {
          name: "pub-subnet",
          vcnId: (vcn as unknown as { id: string }).id,
          cidrBlock: "10.0.1.0/24",
        },
        createElement(ComputeLayer),
      );
    }

    function ComputeLayer() {
      const vcn = useContext(VcnCtx);
      const subnet = useContext(SubnetCtx);
      return createElement(Instance, {
        name: "web-0",
        vcnId: (vcn as unknown as { id: string }).id,
        subnetId: (subnet as unknown as { id: string }).id,
        instanceType: "t3.micro",
      });
    }

    function App() {
      return createElement(
        Vcn,
        { name: "main-vcn", cidrBlock: "10.0.0.0/16" },
        createElement(SubnetLayer),
      );
    }

    renderToPulumi(App)();

    // All 3 resources created in order
    expect(created).toHaveLength(3);

    expect(created[0]).toMatchObject({ type: "e2e:core:Vcn", name: "main-vcn" });
    expect(created[0].args.cidrBlock).toBe("10.0.0.0/16");

    expect(created[1]).toMatchObject({ type: "e2e:core:Subnet", name: "pub-subnet" });
    expect(created[1].args.vcnId).toBe("vcn-001");

    expect(created[2]).toMatchObject({ type: "e2e:core:Instance", name: "web-0" });
    expect(created[2].args.vcnId).toBe("vcn-001");
    expect(created[2].args.subnetId).toBe("subnet-001");
  });

  it("sibling Vcns have isolated Context scopes", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    const capturedVcnNames: string[] = [];

    function Reader({ label }: { label: string }) {
      const vcn = useContext(VcnCtx);
      capturedVcnNames.push(`${label}:${(vcn as unknown as { name: string }).name}`);
      return createElement(Instance, { name: `${label}-inst` });
    }

    function App() {
      return [
        createElement(
          Vcn,
          { name: "vpc-prod", key: "prod", cidrBlock: "10.1.0.0/16" },
          createElement(Reader, { label: "prod" }),
        ),
        createElement(
          Vcn,
          { name: "vpc-staging", key: "staging", cidrBlock: "10.2.0.0/16" },
          createElement(Reader, { label: "staging" }),
        ),
      ] as unknown as React.ReactElement;
    }

    renderToPulumi(App)();

    expect(capturedVcnNames).toContain("prod:vpc-prod");
    expect(capturedVcnNames).toContain("staging:vpc-staging");
    // 2 Vcn + 2 Instance = 4 resources
    expect(created).toHaveLength(4);
  });

  it("inner Vcn overrides outer Vcn Context for nested scope", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    let outerVcnName = "";
    let innerVcnName = "";

    function OuterReader() {
      const vcn = useContext(VcnCtx);
      outerVcnName = (vcn as unknown as { name: string }).name;
      return null;
    }

    function InnerReader() {
      const vcn = useContext(VcnCtx);
      innerVcnName = (vcn as unknown as { name: string }).name;
      return null;
    }

    function App() {
      return createElement(
        Vcn,
        { name: "outer-vpc", cidrBlock: "10.0.0.0/16" },
        createElement(OuterReader),
        createElement(
          Vcn,
          { name: "inner-vpc", cidrBlock: "10.1.0.0/16" },
          createElement(InnerReader),
        ),
      );
    }

    renderToPulumi(App)();

    expect(outerVcnName).toBe("outer-vpc");
    expect(innerVcnName).toBe("inner-vpc");
  });
});

// ─────────────────────────────────────────────────────────────
// E2E: Render props mode
// ─────────────────────────────────────────────────────────────
describe("E2E: render props through renderToPulumi", () => {
  it("chains render props across three layers", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    function App() {
      return createElement(
        Vcn,
        { name: "rp-vcn", cidrBlock: "10.0.0.0/16" },
        (vcn: { id: string }) =>
          createElement(
            Subnet,
            {
              name: "rp-subnet",
              vcnId: vcn.id,
              cidrBlock: "10.0.1.0/24",
            },
            (subnet: { id: string }) =>
              createElement(Instance, {
                name: "rp-inst",
                subnetId: subnet.id,
                vcnId: vcn.id,
              }),
          ),
      );
    }

    renderToPulumi(App)();

    expect(created).toHaveLength(3);
    expect(created[0]).toMatchObject({ name: "rp-vcn" });
    expect(created[1]).toMatchObject({ name: "rp-subnet" });
    expect(created[1].args.vcnId).toBe("vcn-001");
    expect(created[2]).toMatchObject({ name: "rp-inst" });
    expect(created[2].args.subnetId).toBe("subnet-001");
    expect(created[2].args.vcnId).toBe("vcn-001");
  });

  it("render props + Context coexist: render prop child can read Context deeper", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    let deepVcnName = "";

    function DeepReader() {
      const vcn = useContext(VcnCtx);
      deepVcnName = (vcn as unknown as { name: string }).name;
      return createElement(Instance, { name: "deep-inst" });
    }

    function App() {
      return createElement(Vcn, { name: "mixed-vcn", cidrBlock: "10.0.0.0/16" }, (_vcn: unknown) =>
        createElement(Subnet, { name: "mixed-subnet" }, createElement(DeepReader)),
      );
    }

    renderToPulumi(App)();

    expect(deepVcnName).toBe("mixed-vcn");
    expect(created).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────
// E2E: Context + useState persistence
// ─────────────────────────────────────────────────────────────
describe("E2E: Context + useState coexist", () => {
  it("useState controls replica count, Context wires Outputs", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    function Instances() {
      const vcn = useContext(VcnCtx);
      const [replicas] = useState(3);
      return Array.from({ length: replicas }, (_, i) =>
        createElement(Instance, {
          key: i,
          name: `web-${i}`,
          vcnId: (vcn as unknown as { id: string }).id,
        }),
      ) as unknown as React.ReactElement;
    }

    function App() {
      return createElement(
        Vcn,
        { name: "state-vcn", cidrBlock: "10.0.0.0/16" },
        createElement(Instances),
      );
    }

    renderToPulumi(App)();

    // 1 Vcn + 3 Instances = 4 resources
    expect(created).toHaveLength(4);
    expect(created[0]).toMatchObject({ name: "state-vcn" });

    for (let i = 1; i <= 3; i++) {
      expect(created[i]).toMatchObject({ name: `web-${i - 1}` });
      expect(created[i].args.vcnId).toBe("vcn-001");
    }

    // useState should have persisted
    expect(sdk._dynamicResources).toHaveLength(1);
    const state = JSON.parse(sdk._dynamicResources[0].inputs.state as string);
    expect(state.keys).toEqual(["Instances:0"]);
    expect(state.values).toEqual([3]);
  });

  it("hydrated useState + Context wiring across two runs", () => {
    const configStore: Record<string, string> = {};

    // ── Run 1: default replicas=2 ──
    const sdk1 = createMockPulumiSDK(configStore);
    setPulumiSDK(sdk1);

    function Instances() {
      const vcn = useContext(VcnCtx);
      const [replicas] = useState(2);
      return Array.from({ length: replicas }, (_, i) =>
        createElement(Instance, {
          key: i,
          name: `web-${i}`,
          vcnId: (vcn as unknown as { id: string }).id,
        }),
      ) as unknown as React.ReactElement;
    }

    function App1() {
      return createElement(
        Vcn,
        { name: "run1-vcn", cidrBlock: "10.0.0.0/16" },
        createElement(Instances),
      );
    }

    renderToPulumi(App1)();

    expect(created.filter((r) => r.type === "e2e:core:Instance")).toHaveLength(2);

    // Persist & change replicas to 5
    configStore["react-pulumi:state"] = JSON.stringify({
      keys: ["Instances:0"],
      values: [5],
    });

    // ── Run 2: hydrated replicas=5 ──
    resetTracking();
    const sdk2 = createMockPulumiSDK(configStore);
    setPulumiSDK(sdk2);

    function App2() {
      return createElement(
        Vcn,
        { name: "run2-vcn", cidrBlock: "10.0.0.0/16" },
        createElement(Instances),
      );
    }

    renderToPulumi(App2)();

    const instances = created.filter((r) => r.type === "e2e:core:Instance");
    expect(instances).toHaveLength(5);
    // All instances wired to Vcn via Context
    for (const inst of instances) {
      expect(inst.args.vcnId).toBe("vcn-001");
    }
  });
});

// ─────────────────────────────────────────────────────────────
// E2E: Multiple Context types (Vcn + SecurityGroup)
// ─────────────────────────────────────────────────────────────
describe("E2E: multiple Context types", () => {
  it("reads from two different Contexts simultaneously", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    function ComputeLayer() {
      const vcn = useContext(VcnCtx);
      const sg = useContext(SGCtx);
      return createElement(Instance, {
        name: "multi-ctx-inst",
        vcnId: (vcn as unknown as { id: string }).id,
        securityGroupId: (sg as unknown as { id: string }).id,
      });
    }

    function App() {
      return createElement(
        Vcn,
        { name: "multi-vcn", cidrBlock: "10.0.0.0/16" },
        createElement(
          SecurityGroup,
          { name: "web-sg", vcnId: "vcn-001" },
          createElement(ComputeLayer),
        ),
      );
    }

    renderToPulumi(App)();

    expect(created).toHaveLength(3);
    const inst = created.find((r) => r.name === "multi-ctx-inst")!;
    expect(inst.args.vcnId).toBe("vcn-001");
    expect(inst.args.securityGroupId).toBe("sg-001");
  });
});

// ─────────────────────────────────────────────────────────────
// E2E: Conditional rendering with Context
// ─────────────────────────────────────────────────────────────
describe("E2E: conditional rendering with Context", () => {
  it("conditionally created resources still wire Context correctly", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    function MaybeSubnet({ create }: { create: boolean }) {
      const vcn = useContext(VcnCtx);
      if (!create) return null;
      return createElement(Subnet, {
        name: "conditional-subnet",
        vcnId: (vcn as unknown as { id: string }).id,
      });
    }

    function App() {
      return createElement(
        Vcn,
        { name: "cond-vcn", cidrBlock: "10.0.0.0/16" },
        createElement(MaybeSubnet, { create: true }),
        createElement(MaybeSubnet, { create: false }),
      );
    }

    renderToPulumi(App)();

    // 1 Vcn + 1 Subnet (the false one is skipped)
    expect(created).toHaveLength(2);
    expect(created[1]).toMatchObject({ name: "conditional-subnet" });
    expect(created[1].args.vcnId).toBe("vcn-001");
  });
});

// ─────────────────────────────────────────────────────────────
// E2E: Dynamic list with Context + key
// ─────────────────────────────────────────────────────────────
describe("E2E: dynamic list with Context", () => {
  it("map over array producing resources that read ancestor Context", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    const zones = ["a", "b", "c"];

    function Subnets() {
      const vcn = useContext(VcnCtx);
      return zones.map((zone) =>
        createElement(Subnet, {
          key: zone,
          name: `subnet-${zone}`,
          vcnId: (vcn as unknown as { id: string }).id,
          availabilityZone: zone,
        }),
      ) as unknown as React.ReactElement;
    }

    function App() {
      return createElement(
        Vcn,
        { name: "list-vcn", cidrBlock: "10.0.0.0/16" },
        createElement(Subnets),
      );
    }

    renderToPulumi(App)();

    // 1 Vcn + 3 Subnets
    expect(created).toHaveLength(4);
    const subnets = created.filter((r) => r.type === "e2e:core:Subnet");
    expect(subnets).toHaveLength(3);
    for (const s of subnets) {
      expect(s.args.vcnId).toBe("vcn-001");
    }
    expect(subnets.map((s) => s.name)).toEqual(["subnet-a", "subnet-b", "subnet-c"]);
  });
});

// ─────────────────────────────────────────────────────────────
// E2E: opts passthrough (protect, provider instances)
// ─────────────────────────────────────────────────────────────
describe("E2E: opts passthrough via Context", () => {
  it("passes opts.protect through renderToPulumi pipeline", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    function App() {
      return createElement(Vcn, {
        name: "protected-vcn",
        cidrBlock: "10.0.0.0/16",
        opts: { protect: true, ignoreChanges: ["tags"] },
      });
    }

    renderToPulumi(App)();

    expect(created).toHaveLength(1);
    expect(created[0].opts.protect).toBe(true);
    expect(created[0].opts.ignoreChanges).toEqual(["tags"]);
  });

  it("passes parent instance via opts using Context", () => {
    const sdk = createMockPulumiSDK();
    setPulumiSDK(sdk);

    function ChildSubnet() {
      const vcn = useContext(VcnCtx);
      return createElement(Subnet, {
        name: "child-subnet",
        vcnId: (vcn as unknown as { id: string }).id,
        opts: { parent: vcn },
      });
    }

    function App() {
      return createElement(
        Vcn,
        { name: "parent-vcn", cidrBlock: "10.0.0.0/16" },
        createElement(ChildSubnet),
      );
    }

    renderToPulumi(App)();

    expect(created).toHaveLength(2);
    // The opts.parent should be the VcnClass instance (not null/undefined)
    expect(created[1].opts.parent).toBeDefined();
    expect(created[1].opts.parent).not.toBeNull();
  });
});
