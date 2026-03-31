import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { createElement } from "react";

interface VizOptions {
  port: string;
  stack?: string;
}

export async function viz(entry: string, opts: VizOptions): Promise<void> {
  const entryPath = resolve(entry);
  const port = parseInt(opts.port, 10);

  console.log(`[react-pulumi] Loading ${entryPath}...`);

  const mod = await import(entryPath);
  const App = mod.default ?? mod.App;

  if (!App) {
    console.error("Entry file must export a default component or named `App` export.");
    process.exit(1);
  }

  const {
    renderToResourceTree, collectHookKeys, vizRegistry,
    installInterceptor, loadState, prepareForRerender, resetMiddlewareState,
  } = await import("@react-pulumi/core");
  const { PersistenceMiddleware, BroadcastMiddleware } = await import("@react-pulumi/core/middlewares");
  const { startVizServer, VizHistoryStore, computeTreeHash } = await import("@react-pulumi/viz");

  // ── Middleware pipeline (long-lived, shared across re-renders) ──
  let broadcastFn: (data: string) => void = () => {};
  const persistence = new PersistenceMiddleware();
  const broadcast = new BroadcastMiddleware((data) => broadcastFn(data));
  const middlewares = [persistence, broadcast];

  // Install interceptor ONCE and keep it installed permanently.
  // React 19's ConcurrentRoot runs deferred work after flushSyncWork() —
  // if we cleanup the interceptor between renders, the deferred re-render
  // creates plain (non-intercepted) setters that overwrite the registry entries,
  // breaking state persistence for subsequent invocations.
  loadState({ keys: [], values: [] });
  resetMiddlewareState(randomUUID());
  const cleanupInterceptor = installInterceptor({ middlewares });

  let isFirstRender = true;

  /**
   * Render the app with interceptor + middleware pipeline.
   * State persists between renders via prepareForRerender().
   *
   * Interceptor stays installed permanently — deferred React work after
   * flushSyncWork() will re-render with the intercepted useState, ensuring
   * VizButton/VizInput always capture intercepted setters.
   */
  function renderApp() {
    vizRegistry.unlock();
    vizRegistry.reset();

    if (isFirstRender) {
      isFirstRender = false;
    } else {
      prepareForRerender();
    }

    const result = renderToResourceTree(createElement(App), { returnFiberRoot: true });

    // Lock the registry after the synchronous render. React 19's ConcurrentRoot
    // may run deferred work that re-renders components — those deferred renders
    // would create setters with wrong hook indices that overwrite the correct ones.
    vizRegistry.lock();

    return result.tree;
  }

  // Initial render
  let tree = renderApp();

  // ── Load resource statuses from Pulumi stack state ──

  /**
   * Parse a Pulumi URN into a type::name key for matching against the resource tree.
   * URN format: urn:pulumi:<stack>::<project>::<type>::<name>
   */
  function urnToKey(urn: string): string | null {
    const parts = urn.split("::");
    if (parts.length < 4) return null;
    const type = parts[2];
    const name = parts[3];
    return `${type}::${name}`;
  }

  async function loadResourceStatuses(): Promise<Record<string, string>> {
    try {
      const { LocalWorkspace } = await import("@pulumi/pulumi/automation/index.js");
      const projectName = basename(process.cwd());
      const stackName = opts.stack ?? "dev";

      const stack = await LocalWorkspace.createOrSelectStack({
        projectName,
        stackName,
        program: async () => {},
      });

      const state = await stack.exportStack();
      const resources = (state as any)?.deployment?.resources;
      if (!Array.isArray(resources)) return {};

      const statuses: Record<string, string> = {};
      for (const res of resources) {
        if (!res.urn) continue;
        const key = urnToKey(res.urn);
        if (key) statuses[key] = "created";
      }
      return statuses;
    } catch {
      // Stack doesn't exist yet or Pulumi not configured — return empty
      return {};
    }
  }

  let initialResourceStatuses: Record<string, string> = {};
  try {
    initialResourceStatuses = await loadResourceStatuses();
    const count = Object.keys(initialResourceStatuses).length;
    if (count > 0) {
      console.log(`[react-pulumi] Loaded ${count} resource statuses from stack state`);
    }
  } catch {
    // Non-fatal — statuses will just be empty
  }

  // ── Viz History Store ──
  const projectDir = process.cwd();
  const historyStore = new VizHistoryStore(projectDir);
  historyStore.load();

  // Snapshot initial state from viz controls
  function snapshotControlState(): Record<string, unknown> {
    const snap: Record<string, unknown> = {};
    for (const ctrl of vizRegistry.list()) {
      if (ctrl.controlType === "input" && ctrl.value !== undefined) {
        snap[ctrl.name] = ctrl.value;
      }
    }
    return snap;
  }

  // Record initial render
  historyStore.append({
    id: randomUUID(),
    entryType: "initial",
    timestamp: Date.now(),
    stateSnapshot: snapshotControlState(),
    treeHash: computeTreeHash(tree),
  });

  console.log(`[react-pulumi] Starting viz server on http://localhost:${port}`);
  console.log(`[react-pulumi] Registered ${vizRegistry.size} viz controls`);

  const server = await startVizServer({
    port,
    tree,
    broadcastMiddleware: broadcast,
    projectDir,
    initialControls: vizRegistry.list(),
    initialResourceStatuses,
    historyStore,
  });

  // Wire broadcast function to WebSocket server
  if (server.wsBroadcaster) {
    broadcastFn = (data) => server.wsBroadcaster!.broadcastRaw(data);
  }

  // Invoke a viz control in the CLI module context (avoids cross-module issues)
  server.onInvoke = async (name: string, value?: unknown) => {
    await vizRegistry.invoke(name, value);
  };

  // Lightweight re-render after viz control change (updates tree + controls)
  server.onRerender = async () => {
    tree = renderApp();
    server.updateTree(tree);
    return { controls: vizRegistry.list() };
  };

  // Time-travel: re-render with historical state, then restore live state
  server.onTimeTravel = async (stateSnapshot: Record<string, unknown>) => {
    // Save current live state
    const liveState = snapshotControlState();

    // Inject historical state via viz control setters
    for (const [name, value] of Object.entries(stateSnapshot)) {
      await vizRegistry.invoke(name, value);
    }

    // Re-render with historical state
    const historicalTree = renderApp();
    const treeHash = computeTreeHash(historicalTree);

    // Restore live state
    for (const [name, value] of Object.entries(liveState)) {
      await vizRegistry.invoke(name, value);
    }
    renderApp(); // Re-render to restore live tree

    return { tree: historicalTree, treeHash };
  };

  // Shared: create a Pulumi stack with the current viz state
  async function createStack() {
    const { LocalWorkspace } = await import("@pulumi/pulumi/automation/index.js");
    const pulumi = await import("@pulumi/pulumi");
    const { setPulumiSDK } = await import("@react-pulumi/core");
    setPulumiSDK(pulumi);

    const projectName = basename(process.cwd());
    const stackName = opts.stack ?? "dev";

    // Snapshot current viz state so the Pulumi program renders with it
    prepareForRerender();

    const stack = await LocalWorkspace.createOrSelectStack({
      projectName,
      stackName,
      program: async () => {
        renderToResourceTree(createElement(App));
      },
    });
    return { stack, stackName };
  }

  // Parse Pulumi output lines into structured resource changes + broadcast status
  function parseOutputLine(
    out: string,
    changes: Array<{ op: string; type: string; name: string }>,
  ) {
    process.stdout.write(out);
    const match = out.match(/^\s+([+~-])\s+(\S+)\s+(\S+)\s+(create|update|delete|same)/);
    if (match) {
      const [, symbol, type, name] = match;
      const op = symbol === "+" ? "create" : symbol === "~" ? "update" : "delete";
      changes.push({ op, type, name });

      // Broadcast real-time resource status
      const key = `${type}::${name}`;
      const status = op === "create" ? "creating" : op === "update" ? "updating" : "deleting";
      server.wsBroadcaster?.broadcast({ type: "resource_status", key, status });
    }
  }

  // Real pulumi preview — runs stack.preview() with current viz state
  server.onPreview = async () => {
    const { stack, stackName } = await createStack();
    console.log(`[react-pulumi] Running preview on stack '${stackName}'...`);

    const resourceChanges: Array<{ op: string; type: string; name: string }> = [];
    const result = await stack.preview({
      onOutput: (out: string) => parseOutputLine(out, resourceChanges),
    });

    prepareForRerender();

    const summary = result.changeSummary ?? {};
    return {
      create: summary.create ?? 0,
      update: summary.update ?? 0,
      delete: (summary as Record<string, number>).delete ?? 0,
      same: summary.same ?? 0,
      resources: resourceChanges,
    };
  };

  // Real pulumi deploy — runs stack.up() with current viz state
  server.onDeploy = async () => {
    const { stack, stackName } = await createStack();
    console.log(`[react-pulumi] Deploying stack '${stackName}'...`);

    const resourceChanges: Array<{ op: string; type: string; name: string }> = [];
    const result = await stack.up({
      onOutput: (out: string) => parseOutputLine(out, resourceChanges),
    });

    // Refresh statuses from stack state after deploy
    try {
      const postDeployStatuses = await loadResourceStatuses();
      server.updateResourceStatuses(postDeployStatuses);
    } catch {
      // Non-fatal
    }

    prepareForRerender();

    const summary = result.summary.resourceChanges ?? {};
    return {
      create: (summary as Record<string, number>).create ?? 0,
      update: (summary as Record<string, number>).update ?? 0,
      delete: (summary as Record<string, number>).delete ?? 0,
      same: (summary as Record<string, number>).same ?? 0,
      resources: resourceChanges,
    };
  };

  console.log(`[react-pulumi] Viz dashboard ready at http://localhost:${server.port}`);
  console.log(`[react-pulumi] WebSocket available at ws://localhost:${server.port}/ws`);

  process.on("SIGINT", () => {
    console.log("\n[react-pulumi] Shutting down viz server...");
    cleanupInterceptor();
    server.close();
    process.exit(0);
  });
}
