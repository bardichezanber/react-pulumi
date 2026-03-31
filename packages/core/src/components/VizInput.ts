/**
 * <VizInput> registers a controllable input in the viz dashboard.
 * Renders nothing — registers synchronously during render (not useEffect)
 * so it works in the reconciler's single-pass server-side render.
 *
 * Usage:
 * ```tsx
 * const [replicas, setReplicas] = useState(2);
 * <VizInput name="replicas" label="Replicas" inputType="number" value={replicas} setValue={setReplicas} />
 * ```
 */

import { vizRegistry } from "../viz-registry.js";

export interface VizInputProps {
  name: string;
  label?: string;
  inputType?: "text" | "number" | "range";
  value: unknown;
  setValue: (value: unknown) => void;
  min?: number;
  max?: number;
  step?: number;
}

export function VizInput({ name, label, inputType, value, setValue, min, max, step }: VizInputProps): null {
  // Register synchronously during render — useEffect doesn't fire in server-side reconciler
  vizRegistry.register({
    name,
    controlType: "input",
    label,
    inputType: inputType ?? "text",
    value,
    min,
    max,
    step,
    setValue,
  });

  return null;
}
