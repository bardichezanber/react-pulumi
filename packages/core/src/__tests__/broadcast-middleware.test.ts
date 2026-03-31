import { beforeEach, describe, expect, it } from "vitest";
import { BroadcastMiddleware } from "../middlewares/broadcast-middleware.js";
import type { DeployOutcomeEvent, HydrateEvent, SetterCallEvent } from "../state-middleware.js";

function makeHydrate(index: number, value: unknown): HydrateEvent {
  return {
    type: "hydrate",
    index,
    value,
    defaultValue: 0,
    seq: index,
    timestamp: Date.now(),
    deployId: "test",
  };
}

function makeSetter(index: number, prev: unknown, next: unknown): SetterCallEvent {
  return {
    type: "setter_call",
    index,
    previousValue: prev,
    newValue: next,
    seq: 100 + index,
    timestamp: Date.now(),
    deployId: "test",
  };
}

function makeOutcome(success: boolean): DeployOutcomeEvent {
  return {
    type: "deploy_outcome",
    deployId: "test",
    success,
    stateSnapshot: { keys: ["App:0"], values: [1] },
    keyMap: { 0: "App:0" },
    seq: 999,
    timestamp: Date.now(),
  };
}

describe("BroadcastMiddleware", () => {
  let messages: string[];
  let mw: BroadcastMiddleware;

  beforeEach(() => {
    messages = [];
    mw = new BroadcastMiddleware((data) => messages.push(data));
  });

  it("broadcasts state_event on onStateChange", () => {
    mw.onStateChange(makeHydrate(0, 42));

    expect(messages).toHaveLength(1);
    const parsed = JSON.parse(messages[0]);
    expect(parsed.type).toBe("state_event");
    expect(parsed.event.type).toBe("hydrate");
    expect(parsed.event.value).toBe(42);
  });

  it("broadcasts deploy_outcome on onDeployOutcome", () => {
    mw.onDeployOutcome(makeOutcome(true));

    expect(messages).toHaveLength(1);
    const parsed = JSON.parse(messages[0]);
    expect(parsed.type).toBe("deploy_outcome");
    expect(parsed.event.success).toBe(true);
  });

  it("populates replay buffer from onInit history", () => {
    const history = [makeHydrate(0, 10), makeOutcome(true)];
    mw.onInit(history);

    expect(mw.getReplayBuffer()).toHaveLength(2);
    expect(mw.getReplayBuffer()[0].type).toBe("hydrate");
  });

  it("replay buffer accumulates onInit + live events", () => {
    mw.onInit([makeHydrate(0, 10)]);
    mw.onStateChange(makeHydrate(1, 20));
    mw.onDeployOutcome(makeOutcome(true));

    const buf = mw.getReplayBuffer();
    expect(buf).toHaveLength(3);
    expect(buf[0].type).toBe("hydrate");
    expect(buf[1].type).toBe("hydrate");
    expect(buf[2].type).toBe("deploy_outcome");
  });

  it("does not crash when broadcast function throws", () => {
    const throwMw = new BroadcastMiddleware(() => {
      throw new Error("ws closed");
    });

    // Should not throw
    throwMw.onStateChange(makeHydrate(0, 1));
    throwMw.onDeployOutcome(makeOutcome(true));
  });

  it("replay buffer preserves order", () => {
    mw.onStateChange(makeHydrate(0, "a"));
    mw.onStateChange(makeSetter(0, "a", "b"));
    mw.onDeployOutcome(makeOutcome(true));

    const buf = mw.getReplayBuffer();
    expect(buf[0].type).toBe("hydrate");
    expect(buf[1].type).toBe("setter_call");
    expect(buf[2].type).toBe("deploy_outcome");
  });
});
