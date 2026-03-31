/**
 * Server-safe types — no React, no Zustand, no CSS.
 * Shared between server.ts, infra-store.ts, and index.ts.
 */

import type { ResourceStatus } from "@react-pulumi/core";

export type { ResourceStatus };

export type DeploymentStatus =
  | "idle"
  | "previewing"
  | "deploying"
  | "destroying"
  | "complete"
  | "error";

export interface ResourceStatusEntry {
  key: string;
  status: ResourceStatus;
  error?: string;
}
