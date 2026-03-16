/**
 * useStackOutput — read outputs from another Pulumi stack during render.
 *
 * Returns a `pulumi.Output<T>` which resolves during `pulumi up`.
 * Pass the Output directly into resource props — the Pulumi engine resolves it.
 *
 * ```tsx
 * const vpcId = useStackOutput("org/network/prod", "vpcId");
 * return <SecurityGroup name="sg" vpcId={vpcId} />;
 * ```
 *
 * Requires `setPulumiSDK(pulumi)` to have been called before render.
 */

import { getPulumiSDK } from "../pulumi-bridge.js";

// Cache StackReference instances per stack name
const stackRefCache = new Map<string, unknown>();

function getOrCreateStackRef(stackName: string): { getOutput(key: string): unknown } {
  let ref = stackRefCache.get(stackName);
  if (!ref) {
    const pulumi = getPulumiSDK();
    ref = new pulumi.StackReference(stackName);
    stackRefCache.set(stackName, ref);
  }
  return ref as { getOutput(key: string): unknown };
}

/**
 * Read an output from another Pulumi stack.
 *
 * Returns a `pulumi.Output<T>` that resolves during `pulumi up`.
 *
 * ```tsx
 * const vpcId = useStackOutput("org/network/prod", "vpcId");
 * const subnetIds = useStackOutput("org/network/prod", "subnetIds");
 * ```
 *
 * Multiple calls with the same stack name reuse the same StackReference.
 */
export function useStackOutput(stackName: string, outputKey: string): unknown {
  const ref = getOrCreateStackRef(stackName);
  return ref.getOutput(outputKey);
}

/**
 * Reset the StackReference cache. Called between renders by `renderToPulumi`.
 */
export function resetStackRefCache(): void {
  stackRefCache.clear();
}
