/**
 * Shared test helper factories for middleware event types.
 * Used across multiple test files to avoid DRY violations.
 */

import type { DeployOutcomeEvent, HydrateEvent, SetterCallEvent } from "../state-middleware.js";

export function makeHydrateEvent(
  index: number,
  value: unknown,
  deployId = "test-deploy",
): HydrateEvent {
  return {
    type: "hydrate",
    index,
    value,
    defaultValue: 0,
    seq: index,
    timestamp: Date.now(),
    deployId,
  };
}

export function makeSetterCallEvent(
  index: number,
  previousValue: unknown,
  newValue: unknown,
  deployId = "test-deploy",
): SetterCallEvent {
  return {
    type: "setter_call",
    index,
    previousValue,
    newValue,
    seq: 100 + index,
    timestamp: Date.now(),
    deployId,
  };
}

export function makeDeployOutcomeEvent(
  success = true,
  deployId = "test-deploy",
): DeployOutcomeEvent {
  return {
    type: "deploy_outcome",
    deployId,
    success,
    stateSnapshot: { keys: ["App:0"], values: [1] },
    keyMap: { 0: "App:0" },
    seq: 999,
    timestamp: Date.now(),
  };
}
