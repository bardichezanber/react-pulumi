/**
 * renderToPulumi — the top-level entry point for using react-pulumi
 * with standard `pulumi up`. Handles:
 *
 * 1. Reading persisted useState values from Pulumi.<stack>.yaml
 * 2. Intercepting React's useState to hydrate from persisted state
 * 3. Rendering JSX to a ResourceNode tree
 * 4. Materializing the tree into real Pulumi resources
 * 5. Creating a dynamic resource that writes state back to config on deploy success
 */

import { createElement, type FC } from "react";
import { renderToResourceTree, collectHookKeys } from "./renderer.js";
import { getPulumiSDK } from "./pulumi-bridge.js";
import { loadState, collectState, resetState, type PersistedState } from "./state-store.js";
import { installInterceptor } from "./state-interceptor.js";
import { resetConfigCache } from "./hooks/useConfig.js";
import { resetStackRefCache } from "./hooks/useStackOutput.js";

function keysMatch(prev: string[], current: string[]): boolean {
  if (prev.length !== current.length) return false;
  return prev.every((k, i) => k === current[i]);
}

/**
 * Create a Pulumi dynamic resource that writes state back to
 * Pulumi.<stack>.yaml on successful deploy.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createStateHookResource(pulumi: any, state: PersistedState): void {
  const stateJson = JSON.stringify(state);

  // Dynamic import of child_process — resolved at Pulumi deploy time.
  // The module specifier is built as a variable to avoid TypeScript resolving
  // it (no @types/node in this package). Works fine at runtime in Node.js.
  const cpModule = "child_process";
  async function execPulumiCmd(cmd: string): Promise<void> {
    const cp = (await import(cpModule)) as { execSync: (cmd: string, opts: { stdio: string }) => void };
    cp.execSync(cmd, { stdio: "ignore" });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const provider: any = {
    async create(inputs: { state: string }) {
      const escaped = inputs.state.replace(/'/g, "'\\''");
      await execPulumiCmd(`pulumi config set react-pulumi:state '${escaped}'`);
      return { id: "react-pulumi-state", outs: inputs };
    },
    async update(_id: string, _olds: unknown, news: { state: string }) {
      const escaped = news.state.replace(/'/g, "'\\''");
      await execPulumiCmd(`pulumi config set react-pulumi:state '${escaped}'`);
      return { outs: news };
    },
    async delete() {
      try {
        await execPulumiCmd("pulumi config rm react-pulumi:state");
      } catch {
        // Ignore errors during delete — config key may already be gone
      }
    },
  };

  new pulumi.dynamic.Resource(
    provider,
    "__react_pulumi_state",
    { state: stateJson },
  );
}

/**
 * Wraps a React component for use as a standard Pulumi program.
 *
 * Usage:
 * ```tsx
 * import * as pulumi from "@pulumi/pulumi";
 * import { renderToPulumi, setPulumiSDK } from "@react-pulumi/core";
 * setPulumiSDK(pulumi);
 * export default renderToPulumi(App);
 * ```
 *
 * The returned value is a function suitable for Pulumi's inline program
 * or as the default export of an index.ts used by `pulumi up`.
 */
export function renderToPulumi(Component: FC): () => void {
  return () => {
    const pulumi = getPulumiSDK();

    // 1. Read persisted state from Pulumi config (synchronous)
    const config = new pulumi.Config("react-pulumi");
    const stateJson = config.get("state") as string | undefined;
    const prevState: PersistedState = stateJson
      ? JSON.parse(stateJson)
      : { keys: [], values: [] };
    loadState(prevState);

    // 2. Install useState interceptor and render
    //    Resources are created at render time (as side effects of FC components
    //    returned by pulumiToComponent), so no separate materializeTree step needed.
    const cleanup = installInterceptor();
    let renderResult;
    try {
      renderResult = renderToResourceTree(createElement(Component), {
        returnFiberRoot: true,
      });
    } finally {
      cleanup();
    }

    const { fiberRoot } = renderResult;

    // 3. Collect hook keys and validate against previous state
    const keys = collectHookKeys(fiberRoot);

    if (prevState.keys.length > 0 && !keysMatch(prevState.keys, keys)) {
      console.warn(
        "[react-pulumi] Component structure changed — hook keys no longer match. " +
          "Some state values may reset to defaults.",
      );
    }

    // 4. Create state hook resource (writes config on deploy success)
    const newState = collectState(keys);
    if (keys.length > 0) {
      createStateHookResource(pulumi, newState);
    }

    resetState();
    resetConfigCache();
    resetStackRefCache();
  };
}
