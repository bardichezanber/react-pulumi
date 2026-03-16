import { useEffect } from "react";
import { actionRegistry } from "../action-registry.js";

export interface ActionProps {
  /** Unique name for this action */
  name: string;
  /** Handler function invoked when the action is triggered */
  handler: (...args: unknown[]) => unknown | Promise<unknown>;
  /** Optional description for the viz dashboard */
  description?: string;
}

/**
 * <Action> registers a mutation handler in the ActionRegistry.
 * These are surfaced via the viz dashboard and REST API.
 */
export function Action({ name, handler, description }: ActionProps) {
  useEffect(() => {
    actionRegistry.register(name, handler, description);
    return () => {
      actionRegistry.unregister(name);
    };
  }, [name, handler, description]);

  return null;
}
