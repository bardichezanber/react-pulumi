/**
 * <VizButton> registers a clickable button in the viz dashboard.
 * Renders nothing — registers synchronously during render (not useEffect)
 * so it works in the reconciler's single-pass server-side render.
 *
 * Usage:
 * ```tsx
 * <VizButton name="scale-up" label="Add Instance" handler={() => setReplicas(n => n + 1)} />
 * ```
 */

import { vizRegistry } from "../viz-registry.js";

export interface VizButtonProps {
  name: string;
  label?: string;
  description?: string;
  handler: () => void | Promise<void>;
}

export function VizButton({ name, label, description, handler }: VizButtonProps): null {
  // Register synchronously during render — useEffect doesn't fire in server-side reconciler
  vizRegistry.register({
    name,
    controlType: "button",
    label,
    description,
    handler,
  });

  return null;
}
