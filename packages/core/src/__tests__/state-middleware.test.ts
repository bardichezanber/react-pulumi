import { beforeEach, describe, expect, it, vi } from "vitest";
import { PersistenceMiddleware } from "../middlewares/persistence-middleware.js";
import type {
  DeployOutcomeEvent,
  HydrateEvent,
  SetterCallEvent,
  StateMiddleware,
} from "../state-middleware.js";
import {
  dispatchDeployOutcome,
  dispatchStateChange,
  getDeployId,
  nextSeq,
  resetMiddlewareState,
} from "../state-middleware.js";
import * as stateStore from "../state-store.js";

beforeEach(() => {
  resetMiddlewareState("test-deploy-id");
  stateStore.resetState();
});

describe("dispatchStateChange", () => {
  it("calls onStateChange on all middlewares in order", () => {
    const calls: string[] = [];
    const mw1: StateMiddleware = { onStateChange: () => calls.push("mw1") };
    const mw2: StateMiddleware = { onStateChange: () => calls.push("mw2") };

    const event: HydrateEvent = {
      type: "hydrate",
      index: 0,
      value: 42,
      defaultValue: 0,
      seq: 0,
      timestamp: Date.now(),
      deployId: "test",
    };

    dispatchStateChange([mw1, mw2], event);
    expect(calls).toEqual(["mw1", "mw2"]);
  });

  it("handles empty middleware array (no-op)", () => {
    const event: HydrateEvent = {
      type: "hydrate",
      index: 0,
      value: 42,
      defaultValue: 0,
      seq: 0,
      timestamp: Date.now(),
      deployId: "test",
    };

    // Should not throw
    dispatchStateChange([], event);
  });

  it("continues dispatching when a middleware throws", () => {
    const calls: string[] = [];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mw1: StateMiddleware = {
      onStateChange: () => {
        throw new Error("mw1 error");
      },
    };
    const mw2: StateMiddleware = { onStateChange: () => calls.push("mw2") };

    const event: HydrateEvent = {
      type: "hydrate",
      index: 0,
      value: 42,
      defaultValue: 0,
      seq: 0,
      timestamp: Date.now(),
      deployId: "test",
    };

    dispatchStateChange([mw1, mw2], event);
    expect(calls).toEqual(["mw2"]);
    expect(warnSpy).toHaveBeenCalledOnce();

    warnSpy.mockRestore();
  });
});

describe("dispatchDeployOutcome", () => {
  it("calls onDeployOutcome when defined", () => {
    const received: DeployOutcomeEvent[] = [];
    const mw: StateMiddleware = {
      onStateChange: () => {},
      onDeployOutcome: (event) => received.push(event),
    };

    const event: DeployOutcomeEvent = {
      type: "deploy_outcome",
      deployId: "test",
      success: true,
      stateSnapshot: { keys: ["App:0"], values: [1] },
      keyMap: { 0: "App:0" },
      seq: 0,
      timestamp: Date.now(),
    };

    dispatchDeployOutcome([mw], event);
    expect(received).toHaveLength(1);
    expect(received[0].success).toBe(true);
  });

  it("skips middlewares without onDeployOutcome", () => {
    const mw: StateMiddleware = { onStateChange: () => {} };
    const event: DeployOutcomeEvent = {
      type: "deploy_outcome",
      deployId: "test",
      success: true,
      stateSnapshot: { keys: [], values: [] },
      keyMap: {},
      seq: 0,
      timestamp: Date.now(),
    };

    // Should not throw
    dispatchDeployOutcome([mw], event);
  });

  it("continues dispatching when a middleware throws", () => {
    const calls: string[] = [];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mw1: StateMiddleware = {
      onStateChange: () => {},
      onDeployOutcome: () => {
        throw new Error("boom");
      },
    };
    const mw2: StateMiddleware = {
      onStateChange: () => {},
      onDeployOutcome: () => calls.push("mw2"),
    };

    const event: DeployOutcomeEvent = {
      type: "deploy_outcome",
      deployId: "test",
      success: true,
      stateSnapshot: { keys: [], values: [] },
      keyMap: {},
      seq: 0,
      timestamp: Date.now(),
    };

    dispatchDeployOutcome([mw1, mw2], event);
    expect(calls).toEqual(["mw2"]);
    expect(warnSpy).toHaveBeenCalledOnce();

    warnSpy.mockRestore();
  });
});

describe("nextSeq / resetMiddlewareState", () => {
  it("increments seq monotonically", () => {
    resetMiddlewareState("d1");
    expect(nextSeq()).toBe(0);
    expect(nextSeq()).toBe(1);
    expect(nextSeq()).toBe(2);
  });

  it("resets seq to 0 and sets deployId", () => {
    resetMiddlewareState("d1");
    nextSeq();
    nextSeq();

    resetMiddlewareState("d2");
    expect(nextSeq()).toBe(0);
    expect(getDeployId()).toBe("d2");
  });
});

describe("getDeployId", () => {
  it("returns current deployId", () => {
    resetMiddlewareState("my-deploy");
    expect(getDeployId()).toBe("my-deploy");
  });
});

describe("PersistenceMiddleware", () => {
  it("calls trackValue on setter_call events", () => {
    stateStore.loadState({ keys: [], values: [] });
    stateStore.getNextValue(0); // index 0

    const mw = new PersistenceMiddleware();
    const event: SetterCallEvent = {
      type: "setter_call",
      index: 0,
      previousValue: 0,
      newValue: 42,
      seq: 0,
      timestamp: Date.now(),
      deployId: "test",
    };

    mw.onStateChange(event);

    const state = stateStore.collectState(["App:0"]);
    expect(state.values[0]).toBe(42);
  });

  it("ignores hydrate events (no trackValue call)", () => {
    stateStore.loadState({ keys: ["App:0"], values: [10] });
    stateStore.getNextValue(0); // index 0, value hydrated to 10

    const mw = new PersistenceMiddleware();
    const event: HydrateEvent = {
      type: "hydrate",
      index: 0,
      value: 10,
      defaultValue: 0,
      seq: 0,
      timestamp: Date.now(),
      deployId: "test",
    };

    mw.onStateChange(event);

    // Value should remain 10 (from loadState), not changed by hydrate event
    const state = stateStore.collectState(["App:0"]);
    expect(state.values[0]).toBe(10);
  });
});
