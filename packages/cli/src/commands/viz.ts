import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
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
      prepareForRerender(); // reset hookCounter, feed back pendingValues as persisted
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

  // Re-render after viz control invocation (state persists via prepareForRerender)
  server.onPreview = async () => {
    tree = renderApp();
    server.updateTree(tree);
    return { controls: vizRegistry.list() };
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
