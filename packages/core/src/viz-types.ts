/**
 * Shared types for the viz WebSocket protocol and REST API.
 * Used by both server (Node.js) and client (browser).
 */

import type { DeployOutcomeEvent, StateChangeEvent, ActionLogEntry } from "./state-middleware.js";

// ---------------------------------------------------------------------------
// WebSocket message protocol (server → client)
// ---------------------------------------------------------------------------

export type ResourceStatus =
  | "pending"
  | "creating"
  | "created"
  | "updating"
  | "updated"
  | "deleting"
  | "deleted"
  | "failed";

export type ServerMessage =
  | { type: "state_event"; event: StateChangeEvent }
  | { type: "deploy_outcome"; event: DeployOutcomeEvent }
  | { type: "status_update"; status: DeployStatus }
  | { type: "preview_result"; summary: PreviewSummary }
  | { type: "replay"; events: ActionLogEntry[] }
  | { type: "replay_complete" }
  | { type: "tree_update"; tree: unknown }
  | { type: "action_entry"; entry: VizActionEntry }
  | { type: "resource_status"; key: string; status: ResourceStatus }
  | { type: "resource_statuses_bulk"; statuses: Record<string, ResourceStatus> }
  | { type: "error"; message: string };

export interface VizActionEntry {
  trigger: string;            // "VizButton:scale-up" or "VizInput:region"
  controlType: "input" | "button";
  timestamp: number;
  stateBefore: Record<string, unknown>;  // { replicas: 2, region: "us-west-2", ... }
  stateAfter: Record<string, unknown>;   // { replicas: 3, region: "us-west-2", ... }
}

// ---------------------------------------------------------------------------
// WebSocket message protocol (client → server)
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: "viz_input"; name: string; value: unknown }
  | { type: "viz_action"; name: string };

// ---------------------------------------------------------------------------
// Shared enums and types
// ---------------------------------------------------------------------------

export type DeployStatus = "idle" | "deploying" | "previewing" | "success" | "failed";

export interface PreviewSummary {
  create: number;
  update: number;
  delete: number;
  same: number;
}

export interface DeployHistoryEntry {
  deployId: string;
  timestamp: number;
  success: boolean;
  stateSnapshot: { keys: string[]; values: unknown[] };
  keyMap: Record<number, string>;
}

export interface VizControlDescriptor {
  name: string;
  controlType: "input" | "button";
  label?: string;
  inputType?: "text" | "number" | "range";
  value?: unknown;
  min?: number;
  max?: number;
  step?: number;
  description?: string;
}

// ---------------------------------------------------------------------------
// Viz History — persistent time machine entries
// ---------------------------------------------------------------------------

export interface VizHistoryEntry {
  id: string;
  entryType: "action" | "deploy" | "deploy_failed" | "initial";
  trigger?: string;
  controlType?: "input" | "button";
  timestamp: number;
  /** Full state snapshot — any entry can independently restore state */
  stateSnapshot: Record<string, unknown>;
  /** State before the action (for diff display) */
  stateBefore?: Record<string, unknown>;
  /** State after the action (for diff display) */
  stateAfter?: Record<string, unknown>;
  /** SHA-256 of serialized tree — detects code changes without storing full tree */
  treeHash: string;
  deployId?: string;
  deploySuccess?: boolean;
  /** Resource statuses snapshot at this point */
  resourceStatuses?: Record<string, string>;
}
