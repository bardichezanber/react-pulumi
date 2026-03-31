/**
 * Unified Zustand store for the viz dashboard.
 * Replaces the old useVizStore with infra state + timeline + deploy controls.
 * Zustand devtools middleware sends every state change to Redux DevTools.
 */

import type { ResourceNode, VizControlDescriptor, ActionLogEntry, DeployHistoryEntry, VizActionEntry } from "@react-pulumi/core";
import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { DeploymentStatus, ResourceStatus, ResourceStatusEntry } from "./types.js";

export interface InfraState {
  // Resource graph
  resourceTree: ResourceNode | null;
  deploymentStatus: DeploymentStatus;
  resourceStatuses: Record<string, ResourceStatusEntry>;

  // Timeline (raw middleware events — kept for debugging)
  timeline: ActionLogEntry[];
  deployHistory: DeployHistoryEntry[];

  // Action log — user-initiated actions for the Timeline UI
  actions: VizActionEntry[];

  // Viz controls
  vizControls: VizControlDescriptor[];

  // WebSocket
  wsConnected: boolean;
  wsReplayDone: boolean;

  // Actions
  setResourceTree: (tree: ResourceNode) => void;
  setDeploymentStatus: (status: DeploymentStatus) => void;
  updateResourceStatus: (urn: string, status: ResourceStatus, error?: string) => void;
  appendTimelineEntry: (entry: ActionLogEntry) => void;
  appendAction: (entry: VizActionEntry) => void;
  setActions: (actions: VizActionEntry[]) => void;
  setDeployHistory: (history: DeployHistoryEntry[]) => void;
  setVizControls: (controls: VizControlDescriptor[]) => void;
  setWsConnected: (connected: boolean) => void;
  setWsReplayDone: (done: boolean) => void;
  reset: () => void;
}

export const useInfraStore = create<InfraState>()(
  devtools(
    (set) => ({
      resourceTree: null,
      deploymentStatus: "idle",
      resourceStatuses: {},
      timeline: [],
      deployHistory: [],
      actions: [],
      vizControls: [],
      wsConnected: false,
      wsReplayDone: false,

      setResourceTree: (tree) => set({ resourceTree: tree }, false, "setResourceTree"),
      setDeploymentStatus: (status) => set({ deploymentStatus: status }, false, "setDeploymentStatus"),
      updateResourceStatus: (urn, status, error) =>
        set(
          (state) => ({
            resourceStatuses: { ...state.resourceStatuses, [urn]: { urn, status, error } },
          }),
          false,
          "updateResourceStatus",
        ),
      appendTimelineEntry: (entry) =>
        set((state) => ({ timeline: [...state.timeline, entry] }), false, "appendTimelineEntry"),
      appendAction: (entry) =>
        set((state) => ({ actions: [...state.actions, entry] }), false, "appendAction"),
      setActions: (actions) => set({ actions }, false, "setActions"),
      setDeployHistory: (history) => set({ deployHistory: history }, false, "setDeployHistory"),
      setVizControls: (controls) => set({ vizControls: controls }, false, "setVizControls"),
      setWsConnected: (connected) => set({ wsConnected: connected }, false, "setWsConnected"),
      setWsReplayDone: (done) => set({ wsReplayDone: done }, false, "setWsReplayDone"),
      reset: () =>
        set(
          {
            resourceTree: null,
            deploymentStatus: "idle",
            resourceStatuses: {},
            timeline: [],
            deployHistory: [],
            actions: [],
            vizControls: [],
            wsConnected: false,
            wsReplayDone: false,
          },
          false,
          "reset",
        ),
    }),
    { name: "react-pulumi-infra", enabled: true },
  ),
);
