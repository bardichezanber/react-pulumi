import { createElement, useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { PersistenceMiddleware } from "../middlewares/persistence-middleware.js";
import { renderToResourceTree } from "../renderer.js";
import { installInterceptor } from "../state-interceptor.js";
import type {
  HydrateEvent,
  SetterCallEvent,
  StateChangeEvent,
  StateMiddleware,
} from "../state-middleware.js";
import { resetMiddlewareState } from "../state-middleware.js";
import { loadState, resetState } from "../state-store.js";
import { pulumiToComponent } from "../wrap.js";

class MockInstance {
  readonly name: string;
  readonly args: Record<string, unknown>;
  constructor(name: string, args: Record<string, unknown>) {
    this.name = name;
    this.args = args;
  }
}

const [Instance] = pulumiToComponent(MockInstance as never, "aws:ec2:Instance");

/** Spy middleware that records all events */
class SpyMiddleware implements StateMiddleware {
  events: StateChangeEvent[] = [];
  onStateChange(event: StateChangeEvent): void {
    this.events.push(event);
  }
}

beforeEach(() => {
  resetState();
  resetMiddlewareState("integration-test");
});

describe("interceptor + middleware integration", () => {
  it("dispatches HydrateEvent to middlewares on useState", () => {
    loadState({ keys: ["App:0"], values: [5] });

    const spy = new SpyMiddleware();
    const cleanup = installInterceptor({
      middlewares: [new PersistenceMiddleware(), spy],
    });

    function App() {
      const [count] = useState(1);
      return createElement(Instance, { name: "web-0", instanceType: `${count}` });
    }

    renderToResourceTree(createElement(App));
    cleanup();

    expect(spy.events).toHaveLength(1);
    const event = spy.events[0] as HydrateEvent;
    expect(event.type).toBe("hydrate");
    expect(event.index).toBe(0);
    expect(event.value).toBe(5); // hydrated from persisted
    expect(event.defaultValue).toBe(1); // original default
    expect(event.deployId).toBe("integration-test");
  });

  it("dispatches HydrateEvent for each useState hook", () => {
    loadState({ keys: ["App:0", "App:1"], values: [3, "large"] });

    const spy = new SpyMiddleware();
    const cleanup = installInterceptor({
      middlewares: [new PersistenceMiddleware(), spy],
    });

    function App() {
      const [count] = useState(1);
      const [size] = useState("small");
      return createElement(Instance, { name: "web-0", instanceType: `${count}-${size}` });
    }

    renderToResourceTree(createElement(App));
    cleanup();

    // App has 2 useStates; the Instance component (from pulumiToComponent) may
    // trigger additional hooks internally. Filter to only hydrate events.
    const hydrateEvents = spy.events.filter((e): e is HydrateEvent => e.type === "hydrate");
    expect(hydrateEvents.length).toBeGreaterThanOrEqual(2);
    expect(hydrateEvents[0].value).toBe(3);
    expect(hydrateEvents[1].value).toBe("large");
    // Seq should be monotonically increasing
    expect(hydrateEvents[0].seq).toBeLessThan(hydrateEvents[1].seq);
  });

  it("dispatches SetterCallEvent when setter is called", () => {
    loadState({ keys: ["App:0"], values: [10] });

    const spy = new SpyMiddleware();
    const persistence = new PersistenceMiddleware();
    const cleanup = installInterceptor({
      middlewares: [persistence, spy],
    });

    let setter: ((v: number | ((prev: number) => number)) => void) | undefined;
    function App() {
      const [count, setCount] = useState(1);
      setter = setCount;
      return createElement(Instance, { name: "web-0", instanceType: `${count}` });
    }

    renderToResourceTree(createElement(App));

    // Clear hydrate events to focus on setter
    spy.events = [];

    // Call setter
    setter!(42);

    expect(spy.events).toHaveLength(1);
    const event = spy.events[0] as SetterCallEvent;
    expect(event.type).toBe("setter_call");
    expect(event.index).toBe(0);
    expect(event.previousValue).toBe(10); // was hydrated to 10
    expect(event.newValue).toBe(42);

    cleanup();
  });

  it("fixes stale closure: functional update uses current value", () => {
    loadState({ keys: ["App:0"], values: [10] });

    const spy = new SpyMiddleware();
    const persistence = new PersistenceMiddleware();
    const cleanup = installInterceptor({
      middlewares: [persistence, spy],
    });

    let setter: ((v: number | ((prev: number) => number)) => void) | undefined;
    function App() {
      const [count, setCount] = useState(0);
      setter = setCount;
      return createElement(Instance, { name: "web-0", instanceType: `${count}` });
    }

    renderToResourceTree(createElement(App));
    spy.events = [];

    // Call setter twice with functional updates
    setter!((prev) => prev + 1); // prev should be 10 (hydrated), result 11
    setter!((prev) => prev + 1); // prev should be 11 (from first call), result 12

    expect(spy.events).toHaveLength(2);

    const first = spy.events[0] as SetterCallEvent;
    expect(first.previousValue).toBe(10);
    expect(first.newValue).toBe(11);

    const second = spy.events[1] as SetterCallEvent;
    expect(second.previousValue).toBe(11); // NOT 10 — stale closure fixed!
    expect(second.newValue).toBe(12);

    cleanup();
  });

  it("seq increases across hydrate and setter events", () => {
    loadState({ keys: ["App:0"], values: [5] });
    resetMiddlewareState("seq-test");

    const spy = new SpyMiddleware();
    const cleanup = installInterceptor({
      middlewares: [new PersistenceMiddleware(), spy],
    });

    let setter: ((v: number | ((prev: number) => number)) => void) | undefined;
    function App() {
      const [count, setCount] = useState(1);
      setter = setCount;
      return createElement(Instance, { name: "web-0", instanceType: `${count}` });
    }

    renderToResourceTree(createElement(App));
    setter!(99);

    // hydrate event seq=0, setter event seq=1
    expect(spy.events[0].seq).toBe(0);
    expect(spy.events[1].seq).toBe(1);

    cleanup();
  });
});
