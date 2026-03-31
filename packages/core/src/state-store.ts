/**
 * In-memory state store for persisting React useState values
 * across Pulumi deployments via Pulumi.<stack>.yaml config.
 *
 * Uses globalThis to ensure a single state instance across module duplicates
 * (tsx + pnpm can load src/ and dist/ as separate modules with separate state).
 */

export interface PersistedState {
  keys: string[];
  values: unknown[];
}

interface StateStoreData {
  persisted: PersistedState;
  hookCounter: number;
  pendingValues: unknown[];
}

const STATE_KEY = Symbol.for("react-pulumi:stateStore");
const g = globalThis as unknown as Record<symbol, StateStoreData>;
const _s: StateStoreData = g[STATE_KEY] ?? (g[STATE_KEY] = {
  persisted: { keys: [], values: [] },
  hookCounter: 0,
  pendingValues: [],
});

/**
 * Load previously persisted state (from Pulumi config).
 */
export function loadState(state: PersistedState): void {
  _s.persisted = state;
  _s.hookCounter = 0;
  _s.pendingValues = [...state.values];
}

/**
 * Called by the useState interceptor to get the next hydrated value.
 * If a persisted value exists at the current index, return it;
 * otherwise return the provided default.
 */
export function getNextValue(defaultValue: unknown): { index: number; value: unknown } {
  const index = _s.hookCounter++;
  const value = index < _s.persisted.values.length ? _s.persisted.values[index] : defaultValue;
  if (index >= _s.pendingValues.length) {
    _s.pendingValues.push(value);
  }
  return { index, value };
}

/**
 * Called by the useState setter to update the in-memory pending value.
 */
export function trackValue(index: number, value: unknown): void {
  _s.pendingValues[index] = value;
}

/**
 * Collect the final state snapshot for persistence.
 */
export function collectState(keys: string[]): PersistedState {
  return {
    keys,
    values: _s.pendingValues.slice(0, keys.length),
  };
}

/**
 * Prepare for a re-render: feed back pendingValues as persisted,
 * then reset both hookCounter and pendingValues.
 */
export function prepareForRerender(): void {
  _s.persisted = { keys: _s.persisted.keys, values: [..._s.pendingValues] };
  _s.hookCounter = 0;
  _s.pendingValues = [];
}

/**
 * Reset all state (call after renderToPulumi completes).
 */
export function resetState(): void {
  _s.persisted = { keys: [], values: [] };
  _s.hookCounter = 0;
  _s.pendingValues = [];
}
