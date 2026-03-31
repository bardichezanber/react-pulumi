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
  const { startVizServer } = await import("@react-pulumi/viz");

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

  console.log(`[react-pulumi] Starting viz server on http://localhost:${port}`);
  console.log(`[react-pulumi] Registered ${vizRegistry.size} viz controls`);

  const server = await startVizServer({
    port,
    tree,
    broadcastMiddleware: broadcast,
    projectDir: process.cwd(),
    initialControls: vizRegistry.list(),
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

  // Parse Pulumi output lines into structured resource changes
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
