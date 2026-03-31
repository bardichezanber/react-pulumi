/**
 * Unified Zustand store for the viz dashboard.
 * Replaces the old useVizStore with infra state + timeline + deploy controls.
 * Zustand devtools middleware sends every state change to Redux DevTools.
 */

import type {
  ActionLogEntry,
  DeployHistoryEntry,
  ResourceNode,
  VizActionEntry,
  VizControlDescriptor,
  VizHistoryEntry,
} from "@react-pulumi/core";
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

  // Time-travel
  timeTravelEntry: VizHistoryEntry | null;
  timeTravelTree: ResourceNode | null;
  timeTravelCodeChanged: boolean;

  // Actions
  setResourceTree: (tree: ResourceNode) => void;
  setDeploymentStatus: (status: DeploymentStatus) => void;
  updateResourceStatus: (key: string, status: ResourceStatus, error?: string) => void;
  setResourceStatuses: (statuses: Record<string, ResourceStatusEntry>) => void;
  appendTimelineEntry: (entry: ActionLogEntry) => void;
  appendAction: (entry: VizActionEntry) => void;
  setActions: (actions: VizActionEntry[]) => void;
  setDeployHistory: (history: DeployHistoryEntry[]) => void;
  setVizControls: (controls: VizControlDescriptor[]) => void;
  setWsConnected: (connected: boolean) => void;
  setWsReplayDone: (done: boolean) => void;
  setTimeTravelEntry: (entry: VizHistoryEntry | null) => void;
  setTimeTravelTree: (tree: ResourceNode | null) => void;
  setTimeTravelCodeChanged: (changed: boolean) => void;
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
      timeTravelEntry: null,
      timeTravelTree: null,
      timeTravelCodeChanged: false,

      setResourceTree: (tree) => set({ resourceTree: tree }, false, "setResourceTree"),
      setDeploymentStatus: (status) =>
        set({ deploymentStatus: status }, false, "setDeploymentStatus"),
      updateResourceStatus: (key, status, error) =>
        set(
          (state) => ({
            resourceStatuses: { ...state.resourceStatuses, [key]: { key, status, error } },
          }),
          false,
          "updateResourceStatus",
        ),
      setResourceStatuses: (statuses) =>
        set({ resourceStatuses: statuses }, false, "setResourceStatuses"),
      appendTimelineEntry: (entry) =>
        set((state) => ({ timeline: [...state.timeline, entry] }), false, "appendTimelineEntry"),
      appendAction: (entry) =>
        set((state) => ({ actions: [...state.actions, entry] }), false, "appendAction"),
      setActions: (actions) => set({ actions }, false, "setActions"),
      setDeployHistory: (history) => set({ deployHistory: history }, false, "setDeployHistory"),
      setVizControls: (controls) => set({ vizControls: controls }, false, "setVizControls"),
      setWsConnected: (connected) => set({ wsConnected: connected }, false, "setWsConnected"),
      setWsReplayDone: (done) => set({ wsReplayDone: done }, false, "setWsReplayDone"),
      setTimeTravelEntry: (entry) => set({ timeTravelEntry: entry }, false, "setTimeTravelEntry"),
      setTimeTravelTree: (tree) => set({ timeTravelTree: tree }, false, "setTimeTravelTree"),
      setTimeTravelCodeChanged: (changed) =>
        set({ timeTravelCodeChanged: changed }, false, "setTimeTravelCodeChanged"),
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
            timeTravelEntry: null,
            timeTravelTree: null,
            timeTravelCodeChanged: false,
          },
          false,
          "reset",
        ),
    }),
    { name: "react-pulumi-infra", enabled: true },
  ),
);
