/**
 * Unit tests for useInfraStore — Zustand store with devtools middleware.
 * Tests store shape, actions, and state transitions.
 */

import { afterEach, describe, expect, it } from "vitest";
import { useInfraStore } from "../infra-store.js";

afterEach(() => {
  useInfraStore.getState().reset();
});

describe("useInfraStore", () => {
  it("has correct initial state", () => {
    const state = useInfraStore.getState();
    expect(state.resourceTree).toBeNull();
    expect(state.deploymentStatus).toBe("idle");
    expect(state.resourceStatuses).toEqual({});
    expect(state.timeline).toEqual([]);
    expect(state.deployHistory).toEqual([]);
    expect(state.vizControls).toEqual([]);
    expect(state.wsConnected).toBe(false);
    expect(state.wsReplayDone).toBe(false);
  });

  it("setDeploymentStatus updates status", () => {
    useInfraStore.getState().setDeploymentStatus("deploying");
    expect(useInfraStore.getState().deploymentStatus).toBe("deploying");
  });

  it("appendTimelineEntry appends to timeline", () => {
    const event = { type: "hydrate" as const, index: 0, value: 42, defaultValue: 0, seq: 0, timestamp: Date.now(), deployId: "d1" };
    useInfraStore.getState().appendTimelineEntry(event);
    useInfraStore.getState().appendTimelineEntry({ ...event, seq: 1, value: 99 });

    expect(useInfraStore.getState().timeline).toHaveLength(2);
    expect(useInfraStore.getState().timeline[0].seq).toBe(0);
    expect(useInfraStore.getState().timeline[1].seq).toBe(1);
  });

  it("setDeployHistory replaces history", () => {
    useInfraStore.getState().setDeployHistory([
      { deployId: "d1", timestamp: 1000, success: true, stateSnapshot: { keys: [], values: [] }, keyMap: {} },
    ]);
    expect(useInfraStore.getState().deployHistory).toHaveLength(1);

    useInfraStore.getState().setDeployHistory([]);
    expect(useInfraStore.getState().deployHistory).toHaveLength(0);
  });

  it("setVizControls replaces controls", () => {
    useInfraStore.getState().setVizControls([
      { name: "replicas", controlType: "input", inputType: "number", value: 2 },
    ]);
    expect(useInfraStore.getState().vizControls).toHaveLength(1);
    expect(useInfraStore.getState().vizControls[0].name).toBe("replicas");
  });

  it("updateResourceStatus adds entry to record", () => {
    useInfraStore.getState().updateResourceStatus("urn:test:resource", "creating");
    expect(useInfraStore.getState().resourceStatuses["urn:test:resource"]).toEqual({
      key: "urn:test:resource",
      status: "creating",
      error: undefined,
    });
  });

  it("setWsConnected / setWsReplayDone update flags", () => {
    useInfraStore.getState().setWsConnected(true);
    expect(useInfraStore.getState().wsConnected).toBe(true);

    useInfraStore.getState().setWsReplayDone(true);
    expect(useInfraStore.getState().wsReplayDone).toBe(true);
  });

  it("reset clears all state", () => {
    useInfraStore.getState().setDeploymentStatus("deploying");
    useInfraStore.getState().setWsConnected(true);
    useInfraStore.getState().appendTimelineEntry({
      type: "hydrate", index: 0, value: 1, defaultValue: 0, seq: 0, timestamp: Date.now(), deployId: "d1",
    });

    useInfraStore.getState().reset();

    const state = useInfraStore.getState();
    expect(state.deploymentStatus).toBe("idle");
    expect(state.wsConnected).toBe(false);
    expect(state.timeline).toEqual([]);
  });
});
