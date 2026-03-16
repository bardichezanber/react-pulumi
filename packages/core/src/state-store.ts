/**
 * In-memory state store for persisting React useState values
 * across Pulumi deployments via Pulumi.<stack>.yaml config.
 */

export interface PersistedState {
  keys: string[];
  values: unknown[];
}

let persisted: PersistedState = { keys: [], values: [] };
let hookCounter = 0;
let pendingValues: unknown[] = [];

/**
 * Load previously persisted state (from Pulumi config).
 */
export function loadState(state: PersistedState): void {
  persisted = state;
  hookCounter = 0;
  pendingValues = [...state.values];
}

/**
 * Called by the useState interceptor to get the next hydrated value.
 * If a persisted value exists at the current index, return it;
 * otherwise return the provided default.
 */
export function getNextValue(defaultValue: unknown): { index: number; value: unknown } {
  const index = hookCounter++;
  const value = index < persisted.values.length ? persisted.values[index] : defaultValue;
  // Ensure pendingValues has space
  if (index >= pendingValues.length) {
    pendingValues.push(value);
  }
  return { index, value };
}

/**
 * Called by the useState setter to update the in-memory pending value.
 */
export function trackValue(index: number, value: unknown): void {
  pendingValues[index] = value;
}

/**
 * Collect the final state snapshot for persistence.
 */
export function collectState(keys: string[]): PersistedState {
  return {
    keys,
    values: pendingValues.slice(0, keys.length),
  };
}

/**
 * Reset all state (call after renderToPulumi completes).
 */
export function resetState(): void {
  persisted = { keys: [], values: [] };
  hookCounter = 0;
  pendingValues = [];
}
