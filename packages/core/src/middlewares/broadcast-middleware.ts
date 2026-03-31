/**
 * BroadcastMiddleware — forwards state change events to an external
 * broadcast function (typically wired to a WebSocket server).
 *
 * Maintains a replay buffer so newly connecting clients can receive
 * the full event history for the current session.
 *
 * Design: accepts a plain function, not a WebSocket reference.
 * This keeps the core package independent of the `ws` library.
 */

import type {
  ActionLogEntry,
  DeployOutcomeEvent,
  StateChangeEvent,
  StateMiddleware,
} from "../state-middleware.js";

export type BroadcastFn = (data: string) => void;

export class BroadcastMiddleware implements StateMiddleware {
  private readonly broadcast: BroadcastFn;
  private replayBuffer: ActionLogEntry[] = [];

  constructor(broadcast: BroadcastFn) {
    this.broadcast = broadcast;
  }

  onInit(history: ActionLogEntry[]): void {
    this.replayBuffer = [...history];
  }

  onStateChange(event: StateChangeEvent): void {
    this.replayBuffer.push(event);
    try {
      this.broadcast(JSON.stringify({ type: "state_event", event }));
    } catch {
      // Broadcast failure should not break the render pipeline
    }
  }

  onDeployOutcome(event: DeployOutcomeEvent): void {
    this.replayBuffer.push(event);
    try {
      this.broadcast(JSON.stringify({ type: "deploy_outcome", event }));
    } catch {
      // Broadcast failure should not break the render pipeline
    }
  }

  getReplayBuffer(): readonly ActionLogEntry[] {
    return this.replayBuffer;
  }
}
