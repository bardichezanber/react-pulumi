/**
 * Server-safe types — no React, no Zustand, no CSS.
 * Shared between server.ts, infra-store.ts, and index.ts.
 */

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
