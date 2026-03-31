/**
 * PersistenceMiddleware — bridges the middleware pipeline to the existing
 * state-store's trackValue() for persisting useState values across deploys.
 *
 * Only acts on setter_call events (hydrate values are already tracked
 * by getNextValue() in state-store.ts during render).
 */

import type { StateChangeEvent, StateMiddleware } from "../state-middleware.js";
import { trackValue } from "../state-store.js";

export class PersistenceMiddleware implements StateMiddleware {
  onStateChange(event: StateChangeEvent): void {
    if (event.type === "setter_call") {
      trackValue(event.index, event.newValue);
    }
  }
}
