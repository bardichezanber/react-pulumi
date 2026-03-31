import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { resolveProject } from "../project.js";

interface VizOptions {
  port: string;
  stack?: string;
}

export async function viz(entry: string, opts: VizOptions): Promise<void> {
  const { projectDir, projectName, entryPath } = resolveProject(entry);
  const port = parseInt(opts.port, 10);
  const stackName = opts.stack ?? "dev";

  console.log(`[react-pulumi] Loading ${entryPath}...`);

  const mod = await import(entryPath);
  const App = mod.default ?? mod.App;

  if (!App) {
    console.error("Entry file must export a default component or named `App` export.");
    process.exit(1);
  }

  const {
    renderToResourceTree,
    collectHookKeys,
    vizRegistry,
    installInterceptor,
    loadState,
    prepareForRerender,
    resetMiddlewareState,
  } = await import("@react-pulumi/core");
  const { PersistenceMiddleware, BroadcastMiddleware } = await import(
    "@react-pulumi/core/middlewares"
  );
  const { startVizServer, VizHistoryStore, computeTreeHash } = await import("@react-pulumi/viz");

  // ── Middleware pipeline (long-lived, shared across re-renders) ──
  let broadcastFn: (data: string) => void = () => {};
  const persistence = new PersistenceMiddleware();
  const broadcast = new BroadcastMiddleware((data) => broadcastFn(data));
  const middlewares = [persistence, broadcast];

  // Install interceptor ONCE and keep it installed permanently.
  loadState({ keys: [], values: [] });
  resetMiddlewareState(randomUUID());
  const cleanupInterceptor = installInterceptor({ middlewares });

  let isFirstRender = true;

  function renderApp() {
    vizRegistry.unlock();
    vizRegistry.reset();

    if (isFirstRender) {
      isFirstRender = false;
    } else {
      prepareForRerender();
    }

    const result = renderToResourceTree(createElement(App), { returnFiberRoot: true });
    vizRegistry.lock();

    return result.tree;
  }

  // Initial render
  let tree = renderApp();

  // ── Load resource statuses from Pulumi stack state ──

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

      const stack = await LocalWorkspace.createOrSelectStack(
        { projectName, stackName, program: async () => {} },
        { workDir: projectDir },
      );

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
    // Non-fatal
  }

  // ── Viz History Store ──
  const historyStore = new VizHistoryStore(projectDir);
  historyStore.load();

  function snapshotControlState(): Record<string, unknown> {
    const snap: Record<string, unknown> = {};
    for (const ctrl of vizRegistry.list()) {
      if (ctrl.controlType === "input" && ctrl.value !== undefined) {
        snap[ctrl.name] = ctrl.value;
      }
    }
    return snap;
  }

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

  if (server.wsBroadcaster) {
    broadcastFn = (data) => server.wsBroadcaster!.broadcastRaw(data);
  }

  server.onInvoke = async (name: string, value?: unknown) => {
    await vizRegistry.invoke(name, value);
  };

  server.onRerender = async () => {
    tree = renderApp();
    server.updateTree(tree);
    return { controls: vizRegistry.list() };
  };

  server.onRollback = async (targetState: { keys: string[]; values: unknown[] }) => {
    for (let i = 0; i < targetState.keys.length; i++) {
      const name = targetState.keys[i];
      const value = targetState.values[i];
      await vizRegistry.invoke(name, value);
    }
    tree = renderApp();
    server.updateTree(tree);

    const { stack, stackName: sn } = await createStack();
    console.log(`[react-pulumi] Rolling back stack '${sn}'...`);

    const resourceChanges: Array<{ op: string; type: string; name: string }> = [];
    const result = await stack.up({
      onOutput: (out: string) => parseOutputLine(out, resourceChanges),
    });

    try {
      const postDeployStatuses = await loadResourceStatuses();
      server.updateResourceStatuses(postDeployStatuses);
    } catch {
      // Non-fatal
    }

    prepareForRerender();
    return result;
  };

  server.onTimeTravel = async (stateSnapshot: Record<string, unknown>) => {
    const liveState = snapshotControlState();

    for (const [name, value] of Object.entries(stateSnapshot)) {
      await vizRegistry.invoke(name, value);
    }

    const historicalTree = renderApp();
    const treeHash = computeTreeHash(historicalTree);

    for (const [name, value] of Object.entries(liveState)) {
      await vizRegistry.invoke(name, value);
    }
    renderApp();

    return { tree: historicalTree, treeHash };
  };

  // Shared: create a Pulumi stack with the current viz state
  async function createStack() {
    const { LocalWorkspace } = await import("@pulumi/pulumi/automation/index.js");
    const pulumi = await import("@pulumi/pulumi");
    const { setPulumiSDK } = await import("@react-pulumi/core");
    setPulumiSDK(pulumi);

    prepareForRerender();
    const snapshotTree = renderToResourceTree(createElement(App), { returnFiberRoot: true });
    const hookKeys = collectHookKeys(snapshotTree.fiberRoot);
    const { collectState } = await import("@react-pulumi/core");
    const stateSnapshot = collectState(hookKeys);

    const stack = await LocalWorkspace.createOrSelectStack(
      {
        projectName,
        stackName,
        program: async () => {
          loadState(stateSnapshot);
          renderToResourceTree(createElement(App));
        },
      },
      { workDir: projectDir },
    );
    return { stack, stackName };
  }

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

      const key = `${type}::${name}`;
      const status = op === "create" ? "creating" : op === "update" ? "updating" : "deleting";
      server.wsBroadcaster?.broadcast({ type: "resource_status", key, status });
    }
  }

  server.onPreview = async () => {
    const { stack, stackName: sn } = await createStack();
    console.log(`[react-pulumi] Running preview on stack '${sn}'...`);

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

  server.onDeploy = async () => {
    const { stack, stackName: sn } = await createStack();
    console.log(`[react-pulumi] Deploying stack '${sn}'...`);

    const resourceChanges: Array<{ op: string; type: string; name: string }> = [];
    const result = await stack.up({
      onOutput: (out: string) => parseOutputLine(out, resourceChanges),
    });

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
