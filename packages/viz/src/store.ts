import type { ResourceNode } from "@react-pulumi/core";
import { create } from "zustand";

export type DeploymentStatus =
  | "idle"
  | "previewing"
  | "deploying"
  | "destroying"
  | "complete"
  | "error";

export type ResourceStatus =
  | "pending"
  | "creating"
  | "created"
  | "updating"
  | "updated"
  | "deleting"
  | "deleted"
  | "failed";

export interface ResourceStatusEntry {
  urn: string;
  status: ResourceStatus;
  error?: string;
}

export interface VizState {
  resourceTree: ResourceNode | null;
  deploymentStatus: DeploymentStatus;
  resourceStatuses: Map<string, ResourceStatusEntry>;

  // Actions
  setResourceTree: (tree: ResourceNode) => void;
  setDeploymentStatus: (status: DeploymentStatus) => void;
  updateResourceStatus: (urn: string, status: ResourceStatus, error?: string) => void;
  reset: () => void;
}

export const useVizStore = create<VizState>((set) => ({
  resourceTree: null,
  deploymentStatus: "idle",
  resourceStatuses: new Map(),

  setResourceTree: (tree) => set({ resourceTree: tree }),

  setDeploymentStatus: (status) => set({ deploymentStatus: status }),

  updateResourceStatus: (urn, status, error) =>
    set((state) => {
      const next = new Map(state.resourceStatuses);
      next.set(urn, { urn, status, error });
      return { resourceStatuses: next };
    }),

  reset: () =>
    set({
      resourceTree: null,
      deploymentStatus: "idle",
      resourceStatuses: new Map(),
    }),
}));
