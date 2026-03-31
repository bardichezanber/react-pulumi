/**
 * State middleware pipeline — types, interfaces, and dispatch functions.
 *
 * Enables pluggable consumers (PersistenceMiddleware, ActionLogMiddleware,
 * future BroadcastMiddleware) to observe and react to React useState changes
 * in the Pulumi render cycle.
 *
 * Event flow:
 *   useState() → HydrateEvent
 *   setter()   → SetterCallEvent
 *   deploy end → DeployOutcomeEvent
 */

// ---------------------------------------------------------------------------
// Event types (discriminated union)
// ---------------------------------------------------------------------------

export interface HydrateEvent {
  type: "hydrate";
  index: number;
  value: unknown;
  defaultValue: unknown;
  seq: number;
  timestamp: number;
  deployId: string;
}

export interface SetterCallEvent {
  type: "setter_call";
  index: number;
  previousValue: unknown;
  newValue: unknown;
  seq: number;
  timestamp: number;
  deployId: string;
}

export interface DeployOutcomeEvent {
  type: "deploy_outcome";
  deployId: string;
  success: boolean;
  stateSnapshot: { keys: string[]; values: unknown[] };
  keyMap: Record<number, string>;
  seq: number;
  timestamp: number;
}

export type StateChangeEvent = HydrateEvent | SetterCallEvent;
export type ActionLogEntry = StateChangeEvent | DeployOutcomeEvent;

// ---------------------------------------------------------------------------
// Middleware interface
// ---------------------------------------------------------------------------

export interface StateMiddleware {
  onStateChange(event: StateChangeEvent): void;
  onDeployOutcome?(event: DeployOutcomeEvent): void;
  onInit?(history: ActionLogEntry[]): void;
}

// ---------------------------------------------------------------------------
// Module-level state (reset per renderToPulumi call)
// ---------------------------------------------------------------------------

let seq = 0;
let currentDeployId = "";

export function nextSeq(): number {
  return seq++;
}

export function getDeployId(): string {
  return currentDeployId;
}

export function resetMiddlewareState(deployId: string): void {
  seq = 0;
  currentDeployId = deployId;
}

// ---------------------------------------------------------------------------
// Dispatch helpers (error-resilient — one middleware failing won't break others)
// ---------------------------------------------------------------------------

export function dispatchStateChange(
  middlewares: StateMiddleware[],
  event: StateChangeEvent,
): void {
  for (const mw of middlewares) {
    try {
      mw.onStateChange(event);
    } catch (err) {
      console.warn("[react-pulumi] Middleware onStateChange error:", err);
    }
  }
}

export function dispatchDeployOutcome(
  middlewares: StateMiddleware[],
  event: DeployOutcomeEvent,
): void {
  for (const mw of middlewares) {
    try {
      mw.onDeployOutcome?.(event);
    } catch (err) {
      console.warn("[react-pulumi] Middleware onDeployOutcome error:", err);
    }
  }
}
