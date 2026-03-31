/**
 * Shared types for the viz WebSocket protocol and REST API.
 * Used by both server (Node.js) and client (browser).
 */

import type { DeployOutcomeEvent, StateChangeEvent, ActionLogEntry } from "./state-middleware.js";

// ---------------------------------------------------------------------------
// WebSocket message protocol (server → client)
// ---------------------------------------------------------------------------

export type ServerMessage =
  | { type: "state_event"; event: StateChangeEvent }
  | { type: "deploy_outcome"; event: DeployOutcomeEvent }
  | { type: "status_update"; status: DeployStatus }
  | { type: "preview_result"; summary: PreviewSummary }
  | { type: "replay"; events: ActionLogEntry[] }
  | { type: "replay_complete" }
  | { type: "tree_update"; tree: unknown }
  | { type: "action_entry"; entry: VizActionEntry }
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
