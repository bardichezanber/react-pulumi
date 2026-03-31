/**
 * renderToPulumi — the top-level entry point for using react-pulumi
 * with standard `pulumi up`. Handles:
 *
 * 1. Reading persisted useState values from Pulumi.<stack>.yaml
 * 2. Loading action log history from .react-pulumi/action-log.json
 * 3. Constructing middleware pipeline (Persistence + ActionLog)
 * 4. Intercepting React's useState to hydrate + dispatch events
 * 5. Rendering JSX (resources created as side effects)
 * 6. Creating a dynamic resource that writes state back to config
 * 7. Emitting deploy outcome event → ActionLogMiddleware flushes to disk
 */

import { randomUUID } from "node:crypto";
import { createElement, type FC } from "react";
import { resetConfigCache } from "./hooks/useConfig.js";
import { resetStackRefCache } from "./hooks/useStackOutput.js";
import { ActionLogMiddleware } from "./middlewares/action-log-middleware.js";
import { PersistenceMiddleware } from "./middlewares/persistence-middleware.js";
import { getPulumiSDK } from "./pulumi-bridge.js";
import { collectHookKeys, renderToResourceTree } from "./renderer.js";
import { installInterceptor } from "./state-interceptor.js";
import {
  dispatchDeployOutcome,
  nextSeq,
  resetMiddlewareState,
  type StateMiddleware,
} from "./state-middleware.js";
import { collectState, loadState, type PersistedState, resetState } from "./state-store.js";

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
  // Uses execFileSync with argument array to prevent shell injection.
  const cpModule = "child_process";
  async function execPulumiCmd(args: string[]): Promise<void> {
    const cp = (await import(cpModule)) as {
      execFileSync: (file: string, args: string[], opts: { stdio: string }) => void;
    };
    cp.execFileSync("pulumi", args, { stdio: "ignore" });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const provider: any = {
    async create(inputs: { state: string }) {
      await execPulumiCmd(["config", "set", "react-pulumi:state", inputs.state]);
      return { id: "react-pulumi-state", outs: inputs };
    },
    async update(_id: string, _olds: unknown, news: { state: string }) {
      await execPulumiCmd(["config", "set", "react-pulumi:state", news.state]);
      return { outs: news };
    },
    async delete() {
      try {
        await execPulumiCmd(["config", "rm", "react-pulumi:state"]);
      } catch {
        // Ignore errors during delete — config key may already be gone
      }
    },
  };

  new pulumi.dynamic.Resource(provider, "__react_pulumi_state", { state: stateJson });
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
export interface RenderToPulumiOptions {
  extraMiddlewares?: StateMiddleware[];
}

export function renderToPulumi(Component: FC, options?: RenderToPulumiOptions): () => void {
  return () => {
    const pulumi = getPulumiSDK();

    // 1. Read persisted state from Pulumi config (synchronous)
    const config = new pulumi.Config("react-pulumi");
    const stateJson = config.get("state") as string | undefined;
    const prevState: PersistedState = stateJson ? JSON.parse(stateJson) : { keys: [], values: [] };
    loadState(prevState);

    // 2. Construct middleware pipeline
    const deployId = randomUUID();
    const persistence = new PersistenceMiddleware();
    const actionLog = new ActionLogMiddleware();
    const history = ActionLogMiddleware.loadHistory();
    actionLog.onInit(history);

    const extra = options?.extraMiddlewares ?? [];
    for (const mw of extra) {
      mw.onInit?.(history);
    }

    const middlewares: StateMiddleware[] = [persistence, actionLog, ...extra];
    resetMiddlewareState(deployId);

    // 3. Install useState interceptor with middlewares and render
    //    Resources are created at render time (as side effects of FC components
    //    returned by pulumiToComponent), so no separate materializeTree step needed.
    const cleanup = installInterceptor({ middlewares });
    let renderResult: ReturnType<typeof renderToResourceTree> | undefined;
    try {
      renderResult = renderToResourceTree(createElement(Component), {
        returnFiberRoot: true,
      });
    } finally {
      cleanup();
    }

    try {
      const { fiberRoot } = renderResult;

      // 4. Collect hook keys and validate against previous state
      const keys = collectHookKeys(fiberRoot);

      if (prevState.keys.length > 0 && !keysMatch(prevState.keys, keys)) {
        console.warn(
          "[react-pulumi] Component structure changed — hook keys no longer match. " +
            "Some state values may reset to defaults.",
        );
      }

      // 5. Create state hook resource (writes config on deploy success)
      const newState = collectState(keys);
      if (keys.length > 0) {
        createStateHookResource(pulumi, newState);
      }

      // 6. Emit deploy outcome (optimistic — actual deploy runs later via Pulumi engine)
      const keyMap: Record<number, string> = {};
      for (let i = 0; i < keys.length; i++) {
        keyMap[i] = keys[i];
      }

      dispatchDeployOutcome(middlewares, {
        type: "deploy_outcome",
        deployId,
        success: true,
        stateSnapshot: newState,
        keyMap,
        seq: nextSeq(),
        timestamp: Date.now(),
      });
    } finally {
      // 7. Cleanup — always runs, even if post-render steps throw
      resetState();
      resetMiddlewareState("");
      resetConfigCache();
      resetStackRefCache();
    }
  };
}
