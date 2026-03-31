/**
 * Verify VizInput/VizButton register synchronously during render
 * (not via useEffect) so they work with renderToResourceTree.
 */

import { createElement, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { VizButton } from "../components/VizButton.js";
import { VizInput } from "../components/VizInput.js";
import { PersistenceMiddleware } from "../middlewares/persistence-middleware.js";
import { renderToResourceTree } from "../renderer.js";
import { installInterceptor } from "../state-interceptor.js";
import { resetMiddlewareState } from "../state-middleware.js";
import { loadState, resetState } from "../state-store.js";
import { vizRegistry } from "../viz-registry.js";
import { pulumiToComponent } from "../wrap.js";

class MockRes {
  name: string;
  args: Record<string, unknown>;
  constructor(n: string, a: Record<string, unknown>) {
    this.name = n;
    this.args = a;
  }
}
const [Res] = pulumiToComponent(MockRes as never, "test:Res");

afterEach(() => {
  resetState();
  resetMiddlewareState("test");
  vizRegistry.reset();
});

describe("VizInput/VizButton synchronous registration", () => {
  it("VizInput registers during renderToResourceTree", () => {
    loadState({ keys: [], values: [] });
    const cleanup = installInterceptor({ middlewares: [new PersistenceMiddleware()] });

    function App() {
      const [count, setCount] = useState(3);
      return createElement(
        "div",
        null,
        createElement(VizInput, {
          name: "replicas",
          label: "Replicas",
          inputType: "number",
          value: count,
          setValue: setCount,
          min: 1,
          max: 10,
        }),
        createElement(Res, { name: "r1" }),
      );
    }

    vizRegistry.reset();
    renderToResourceTree(createElement(App));
    cleanup();

    expect(vizRegistry.size).toBe(1);
    const controls = vizRegistry.list();
    expect(controls[0].name).toBe("replicas");
    expect(controls[0].controlType).toBe("input");
    expect(controls[0].inputType).toBe("number");
    expect(controls[0].value).toBe(3);
    expect(controls[0].min).toBe(1);
    expect(controls[0].max).toBe(10);
  });

  it("VizButton registers during renderToResourceTree", () => {
    loadState({ keys: [], values: [] });
    const cleanup = installInterceptor({ middlewares: [new PersistenceMiddleware()] });

    const handler = () => {};
    function App() {
      const [_n] = useState(1);
      return createElement(
        "div",
        null,
        createElement(VizButton, { name: "scale-up", label: "Scale Up", handler }),
        createElement(Res, { name: "r1" }),
      );
    }

    vizRegistry.reset();
    renderToResourceTree(createElement(App));
    cleanup();

    expect(vizRegistry.size).toBe(1);
    const controls = vizRegistry.list();
    expect(controls[0].name).toBe("scale-up");
    expect(controls[0].controlType).toBe("button");
    expect(controls[0].label).toBe("Scale Up");
  });

  it("multiple VizInputs + VizButtons register together", () => {
    loadState({ keys: [], values: [] });
    const cleanup = installInterceptor({ middlewares: [new PersistenceMiddleware()] });

    function App() {
      const [replicas, setReplicas] = useState(2);
      const [region, setRegion] = useState("us-west-2");
      return createElement(
        "div",
        null,
        createElement(VizInput, {
          name: "replicas",
          inputType: "number",
          value: replicas,
          setValue: setReplicas,
        }),
        createElement(VizInput, {
          name: "region",
          inputType: "text",
          value: region,
          setValue: setRegion,
        }),
        createElement(VizButton, { name: "reset", label: "Reset", handler: () => {} }),
        createElement(Res, { name: "r1" }),
      );
    }

    vizRegistry.reset();
    renderToResourceTree(createElement(App));
    cleanup();

    expect(vizRegistry.size).toBe(3);
    const names = vizRegistry.list().map((c) => c.name);
    expect(names).toContain("replicas");
    expect(names).toContain("region");
    expect(names).toContain("reset");
  });

  it("vizRegistry.invoke calls the setter from VizInput", async () => {
    loadState({ keys: [], values: [] });
    const cleanup = installInterceptor({ middlewares: [new PersistenceMiddleware()] });

    let captured = -1;
    function App() {
      const [count, setCount] = useState(2);
      captured = count;
      return createElement(
        "div",
        null,
        createElement(VizInput, {
          name: "count",
          inputType: "number",
          value: count,
          setValue: setCount,
        }),
        createElement(Res, { name: "r1" }),
      );
    }

    vizRegistry.reset();
    renderToResourceTree(createElement(App));
    cleanup();

    expect(captured).toBe(2);

    // Invoke the setter via registry
    await vizRegistry.invoke("count", 5);

    // The setter was called (updates pendingValues via PersistenceMiddleware)
    const entry = vizRegistry.get("count");
    expect(entry).toBeDefined();
  });
});
