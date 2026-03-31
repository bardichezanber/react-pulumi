import { createElement, useState, Fragment } from "react";
import { describe, expect, it } from "vitest";
import { PersistenceMiddleware } from "../middlewares/persistence-middleware.js";
import { renderToResourceTree } from "../renderer.js";
import { installInterceptor } from "../state-interceptor.js";
import type { HydrateEvent, StateChangeEvent, StateMiddleware } from "../state-middleware.js";
import { resetMiddlewareState } from "../state-middleware.js";
import { loadState, resetState, prepareForRerender } from "../state-store.js";
import { vizRegistry } from "../viz-registry.js";
import { VizInput } from "../components/VizInput.js";
import { VizButton } from "../components/VizButton.js";
import { pulumiToComponent } from "../wrap.js";

class Mock { name: string; args: Record<string, unknown>; constructor(n: string, a: Record<string, unknown>) { this.name = n; this.args = a; } }
const [Vpc] = pulumiToComponent(Mock as never, "aws:ec2/vpc:Vpc");
const [SG] = pulumiToComponent(Mock as never, "aws:ec2/sg:SG");
const [Instance] = pulumiToComponent(Mock as never, "aws:ec2/instance:Instance");

class Spy implements StateMiddleware {
  events: StateChangeEvent[] = [];
  onStateChange(e: StateChangeEvent) { this.events.push(e); }
}

describe("debug: hook count and state persistence", () => {
  it("counts hooks and verifies state persistence across re-renders", () => {
    const spy = new Spy();
    const persistence = new PersistenceMiddleware();

    function App() {
      const [replicas, setReplicas] = useState(2);
      const [instanceType, setInstanceType] = useState("t3.micro");
      const [region, setRegion] = useState("us-west-2");
      const [env, setEnv] = useState("production");
      return createElement(Fragment, null,
        createElement(VizInput, { name: "replicas", inputType: "number" as const, value: replicas, setValue: setReplicas, min: 1, max: 10 }),
        createElement(VizInput, { name: "instanceType", inputType: "text" as const, value: instanceType, setValue: setInstanceType }),
        createElement(VizInput, { name: "region", inputType: "text" as const, value: region, setValue: setRegion }),
        createElement(VizInput, { name: "environment", inputType: "text" as const, value: env, setValue: setEnv }),
        createElement(VizButton, { name: "scale-up", label: "Scale Up (+1)", handler: () => setReplicas((n: number) => Math.min(10, n + 1)) }),
        createElement(Vpc, { name: "vpc", cidrBlock: "10.0.0.0/16" },
          createElement(SG, { name: "sg" }),
          ...Array.from({ length: replicas }, (_, i) =>
            createElement(Instance, { key: `web-${i}`, name: `web-${i}` }),
          ),
        ),
      );
    }

    // --- Render 1 ---
    vizRegistry.reset();
    resetState();
    loadState({ keys: [], values: [] });
    resetMiddlewareState("r1");
    let cleanup = installInterceptor({ middlewares: [persistence, spy] });
    renderToResourceTree(createElement(App));
    cleanup();

    const r1Hydrates = spy.events.filter((e): e is HydrateEvent => e.type === "hydrate");
    console.log("Render 1 hydrate count:", r1Hydrates.length);
    for (const h of r1Hydrates) {
      console.log(`  index=${h.index} value=${JSON.stringify(h.value)} default=${JSON.stringify(h.defaultValue)}`);
    }
    expect(r1Hydrates.length).toBeGreaterThanOrEqual(4);

    const replicasCtrl = vizRegistry.list().find(c => c.name === "replicas");
    expect(replicasCtrl?.value).toBe(2);

    // --- Invoke scale-up ---
    vizRegistry.invoke("scale-up");

    // --- Render 2 ---
    spy.events = [];
    vizRegistry.reset();
    prepareForRerender();
    cleanup = installInterceptor({ middlewares: [persistence, spy] });
    renderToResourceTree(createElement(App));
    cleanup();

    const r2Hydrates = spy.events.filter((e): e is HydrateEvent => e.type === "hydrate");
    console.log("\nRender 2 hydrate count:", r2Hydrates.length);
    for (const h of r2Hydrates) {
      console.log(`  index=${h.index} value=${JSON.stringify(h.value)} default=${JSON.stringify(h.defaultValue)}`);
    }

    const replicasAfter = vizRegistry.list().find(c => c.name === "replicas");
    console.log("\nreplicas after scale-up:", replicasAfter?.value);
    expect(replicasAfter?.value).toBe(3); // should be 3 after one scale-up
  });
});
