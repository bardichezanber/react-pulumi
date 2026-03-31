/**
 * Viz HTTP + WebSocket server.
 *
 * REST API:
 *   GET  /api/tree           — resource tree + deployment status
 *   GET  /api/history        — action log deploy history
 *   GET  /api/viz-controls   — registered VizInput/VizButton descriptors
 *   POST /api/deploy         — trigger pulumi up (202 / 409 busy)
 *   POST /api/preview        — trigger pulumi preview (200 + summary)
 *   POST /api/rollback       — set config + pulumi up (202 / 409 busy)
 *   POST /api/viz-controls/:name — invoke a VizInput setter or VizButton handler
 *
 * WebSocket /ws:
 *   Pushes state_event, deploy_outcome, status_update, replay on connect
 */

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DeployStatus,
  ResourceNode,
  VizActionEntry,
  VizControlDescriptor,
} from "@react-pulumi/core";
import type { BroadcastMiddleware } from "@react-pulumi/core/middlewares";
import { ActionLogMiddleware } from "@react-pulumi/core/middlewares";
import type { DeploymentStatus } from "./types.js";
import type { VizHistoryStore } from "./viz-history.js";
import { computeTreeHash } from "./viz-history.js";
import { createWsServer, type WsBroadcaster } from "./ws-server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface VizServerOptions {
  port: number;
  tree: ResourceNode;
  status?: DeploymentStatus;
  broadcastMiddleware?: BroadcastMiddleware;
  projectDir?: string;
  /** Initial controls from the CLI render (avoids cross-module vizRegistry reads) */
  initialControls?: VizControlDescriptor[];
  /** Initial resource statuses from Pulumi stack state (key = type::name) */
  initialResourceStatuses?: Record<string, string>;
  /** Persistent viz history store */
  historyStore?: VizHistoryStore;
}

/** Strip circular `parent` references for JSON serialization */
function treeToJSON(_key: string, value: unknown): unknown {
  if (_key === "parent") return undefined;
  return value;
}

export interface VizServer {
  port: number;
  close: () => void;
  updateTree: (tree: ResourceNode) => void;
  updateStatus: (status: DeploymentStatus) => void;
  updateResourceStatuses: (statuses: Record<string, string>) => void;
  httpServer: HttpServer;
  wsBroadcaster: WsBroadcaster | null;
  /** Set by CLI layer to handle deploy/preview/rollback */
  onDeploy: (() => Promise<unknown>) | null;
  onPreview: (() => Promise<unknown>) | null;
  onRollback: ((targetState: { keys: string[]; values: unknown[] }) => Promise<unknown>) | null;
  /** Set by CLI layer to invoke a viz control (runs in CLI module context) */
  onInvoke: ((name: string, value?: unknown) => Promise<void>) | null;
  /** Lightweight re-render after viz control change (NOT pulumi preview) */
  onRerender: (() => Promise<unknown>) | null;
  /** Time-travel: re-render with historical state, return tree + hash */
  onTimeTravel:
    | ((
        stateSnapshot: Record<string, unknown>,
      ) => Promise<{ tree: ResourceNode; treeHash: string }>)
    | null;
}

export async function startVizServer(opts: VizServerOptions): Promise<VizServer> {
  let currentTree = opts.tree;
  let currentStatus: DeploymentStatus = opts.status ?? "idle";
  let currentResourceStatuses: Record<string, string> = opts.initialResourceStatuses ?? {};
  let busy = false;

  // Action log — records user-initiated state changes for the Timeline
  const actionLog: VizActionEntry[] = [];

  // Persistent history store
  const historyStore = opts.historyStore ?? null;

  // Cache the last known controls for consistent snapshots.
  // Initialized from CLI-provided controls to avoid cross-module vizRegistry reads.
  let lastKnownControls: VizControlDescriptor[] = opts.initialControls ?? [];

  /** Snapshot current state from cached controls (avoids cross-module registry issues) */
  function snapshotState(): Record<string, unknown> {
    const snap: Record<string, unknown> = {};
    for (const ctrl of lastKnownControls) {
      if (ctrl.controlType === "input" && ctrl.value !== undefined) {
        snap[ctrl.name] = ctrl.value;
      }
    }
    return snap;
  }

  // Handler references set by the CLI layer
  let onDeploy: (() => Promise<unknown>) | null = null;
  let onPreview: (() => Promise<unknown>) | null = null;
  let onRollback:
    | ((targetState: { keys: string[]; values: unknown[] }) => Promise<unknown>)
    | null = null;
  let onInvoke: ((name: string, value?: unknown) => Promise<void>) | null = null;
  let onRerender: (() => Promise<unknown>) | null = null;
  let onTimeTravel:
    | ((
        stateSnapshot: Record<string, unknown>,
      ) => Promise<{ tree: ResourceNode; treeHash: string }>)
    | null = null;

  // In production, serve pre-built client from dist/client/
  const clientDir = join(__dirname, "client");

  let mode: "static" | "vite" = "static";
  let viteServer: {
    // biome-ignore lint/complexity/noBannedTypes: Vite middleware type
    middlewares: { handle: Function };
    close: () => Promise<void>;
  } | null = null;

  try {
    await readFile(join(clientDir, "index.html"), "utf-8");
  } catch {
    mode = "vite";
  }

  if (mode === "vite") {
    try {
      const vite = await import("vite");
      const packageRoot = join(__dirname, "..");
      viteServer = await vite.createServer({
        root: packageRoot,
        server: { middlewareMode: true },
        appType: "spa",
      });
    } catch {
      throw new Error(
        "No pre-built client found and Vite is not available. Run `pnpm --filter @react-pulumi/viz build` first.",
      );
    }
  }

  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    // ── JSON helpers ──
    function json(status: number, data: unknown): void {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    }

    async function readBody(): Promise<string> {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString("utf-8");
    }

    // ── API Routes ──

    if (url.pathname === "/api/tree") {
      json(
        200,
        JSON.parse(JSON.stringify({ tree: currentTree, status: currentStatus }, treeToJSON)),
      );
      return;
    }

    if (url.pathname === "/api/history" && req.method === "GET") {
      const history = ActionLogMiddleware.loadHistory(opts.projectDir);
      const entries = history
        .filter(
          (e): e is import("@react-pulumi/core").DeployOutcomeEvent => e.type === "deploy_outcome",
        )
        .map((d) => ({
          deployId: d.deployId,
          timestamp: d.timestamp,
          success: d.success,
          stateSnapshot: d.stateSnapshot,
          keyMap: d.keyMap,
        }));
      json(200, { history: entries });
      return;
    }

    if (url.pathname === "/api/viz-controls" && req.method === "GET") {
      json(200, { controls: lastKnownControls });
      return;
    }

    if (url.pathname === "/api/resource-statuses" && req.method === "GET") {
      json(200, { statuses: currentResourceStatuses });
      return;
    }

    if (url.pathname === "/api/deploy" && req.method === "POST") {
      if (busy) {
        json(409, { error: "Operation in progress" });
        return;
      }
      if (!onDeploy) {
        json(501, { error: "Deploy not configured" });
        return;
      }
      busy = true;
      wsBroadcaster?.broadcast({ type: "status_update", status: "deploying" });
      try {
        const result = await onDeploy();
        wsBroadcaster?.broadcast({ type: "status_update", status: "idle" });

        // Record deploy history
        if (historyStore) {
          historyStore.append({
            id: randomUUID(),
            entryType: "deploy",
            timestamp: Date.now(),
            stateSnapshot: snapshotState(),
            treeHash: computeTreeHash(currentTree),
            deployId: randomUUID().slice(0, 8),
            deploySuccess: true,
            resourceStatuses: { ...currentResourceStatuses },
          });
        }

        json(200, { result });
      } catch (err) {
        wsBroadcaster?.broadcast({ type: "status_update", status: "idle" });

        // Record failed deploy
        if (historyStore) {
          historyStore.append({
            id: randomUUID(),
            entryType: "deploy_failed",
            timestamp: Date.now(),
            stateSnapshot: snapshotState(),
            treeHash: computeTreeHash(currentTree),
            deployId: randomUUID().slice(0, 8),
            deploySuccess: false,
          });
        }

        json(500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        busy = false;
      }
      return;
    }

    if (url.pathname === "/api/preview" && req.method === "POST") {
      if (busy) {
        json(409, { error: "Operation in progress" });
        return;
      }
      if (!onPreview) {
        json(501, { error: "Preview not configured" });
        return;
      }
      busy = true;
      wsBroadcaster?.broadcast({ type: "status_update", status: "previewing" });
      try {
        const result = await onPreview();
        json(200, { result });
      } catch (err) {
        json(500, { error: String(err) });
      } finally {
        wsBroadcaster?.broadcast({ type: "status_update", status: "idle" });
        busy = false;
      }
      return;
    }

    if (url.pathname === "/api/rollback" && req.method === "POST") {
      if (busy) {
        json(409, { error: "Operation in progress" });
        return;
      }
      if (!onRollback) {
        json(501, { error: "Rollback not configured" });
        return;
      }
      try {
        const body = JSON.parse(await readBody());
        if (!body.stateSnapshot) {
          json(400, { error: "Missing stateSnapshot" });
          return;
        }
        busy = true;
        wsBroadcaster?.broadcast({ type: "status_update", status: "deploying" });
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "accepted" }));
        await onRollback(body.stateSnapshot);
        wsBroadcaster?.broadcast({ type: "status_update", status: "idle" });
      } catch (err) {
        wsBroadcaster?.broadcast({ type: "status_update", status: "idle" });
        wsBroadcaster?.broadcast({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        busy = false;
      }
      return;
    }

    // POST /api/viz-controls/:name — invoke control, then re-render (no deploy)
    if (url.pathname.startsWith("/api/viz-controls/") && req.method === "POST") {
      const name = decodeURIComponent(url.pathname.slice("/api/viz-controls/".length));
      try {
        const bodyStr = await readBody();
        const body = bodyStr ? JSON.parse(bodyStr) : {};

        // Look up controlType from cached controls (avoids cross-module vizRegistry reads)
        const cachedCtrl = lastKnownControls.find((c) => c.name === name);
        const controlType = cachedCtrl?.controlType ?? "button";

        const stateBefore = snapshotState();

        // Invoke via CLI callback (runs in CLI module context, avoids module duplication)
        if (onInvoke) {
          await onInvoke(name, body.value);
        }

        // Re-render to get updated controls from CLI context
        let previewResult: unknown = null;
        if (onRerender) {
          try {
            previewResult = await onRerender();
          } catch {
            /* non-fatal */
          }
        }
        const afterControls: VizControlDescriptor[] =
          (previewResult as any)?.controls ?? lastKnownControls;
        const stateAfter: Record<string, unknown> = {};
        for (const ctrl of afterControls) {
          if (ctrl.controlType === "input" && ctrl.value !== undefined) {
            stateAfter[ctrl.name] = ctrl.value;
          }
        }

        const entry: VizActionEntry = {
          trigger: `${controlType === "button" ? "VizButton" : "VizInput"}:${name}`,
          controlType: controlType as "input" | "button",
          timestamp: Date.now(),
          stateBefore,
          stateAfter,
        };
        actionLog.push(entry);
        wsBroadcaster?.broadcast({ type: "action_entry", entry });

        // Record persistent history entry
        if (historyStore) {
          historyStore.append({
            id: randomUUID(),
            entryType: "action",
            trigger: entry.trigger,
            controlType: entry.controlType,
            timestamp: entry.timestamp,
            stateSnapshot: stateAfter,
            stateBefore,
            stateAfter,
            treeHash: computeTreeHash(currentTree),
          });
        }

        lastKnownControls = afterControls;
        json(200, { ok: true, controls: afterControls });
      } catch (err) {
        json(404, { error: String(err) });
      }
      return;
    }

    // GET /api/actions — return action log for Timeline
    if (url.pathname === "/api/actions" && req.method === "GET") {
      json(200, { actions: actionLog });
      return;
    }

    // GET /api/viz-history — persistent history for time machine
    if (url.pathname === "/api/viz-history" && req.method === "GET") {
      json(200, { entries: historyStore?.getAll() ?? [] });
      return;
    }

    // POST /api/time-travel — re-render with historical state
    if (url.pathname === "/api/time-travel" && req.method === "POST") {
      if (!onTimeTravel) {
        json(501, { error: "Time travel not configured" });
        return;
      }
      try {
        const body = JSON.parse(await readBody());
        if (!body.stateSnapshot || !body.originalTreeHash) {
          json(400, { error: "Missing stateSnapshot or originalTreeHash" });
          return;
        }
        const result = (await onTimeTravel(body.stateSnapshot)) as { tree: any; treeHash: string };
        const codeChanged = result.treeHash !== body.originalTreeHash;
        json(200, {
          tree: JSON.parse(JSON.stringify(result.tree, treeToJSON)),
          treeHash: result.treeHash,
          codeChanged,
        });
      } catch (err) {
        json(500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // ── Static / Vite fallthrough ──

    if (mode === "vite" && viteServer) {
      viteServer.middlewares.handle(req, res);
      return;
    }

    let filePath: string;
    if (url.pathname === "/" || url.pathname === "/index.html") {
      filePath = join(clientDir, "index.html");
    } else {
      filePath = join(clientDir, url.pathname);
    }

    try {
      const content = await readFile(filePath);
      const ext = filePath.split(".").pop() ?? "";
      const mimeTypes: Record<string, string> = {
        html: "text/html",
        js: "application/javascript",
        css: "text/css",
        json: "application/json",
        svg: "image/svg+xml",
        png: "image/png",
      };
      res.writeHead(200, { "Content-Type": mimeTypes[ext] ?? "application/octet-stream" });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  // ── WebSocket ──
  let wsBroadcaster: WsBroadcaster | null = null;
  if (opts.broadcastMiddleware) {
    wsBroadcaster = createWsServer({
      httpServer: server,
      broadcastMiddleware: opts.broadcastMiddleware,
    });
  }

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(opts.port, () => {
      const actualPort = (server.address() as { port: number }).port;
      const vizServer: VizServer = {
        port: actualPort,
        httpServer: server,
        wsBroadcaster,
        onDeploy: null,
        onPreview: null,
        onRollback: null,
        onInvoke: null,
        onRerender: null,
        onTimeTravel: null,
        close: () => {
          wsBroadcaster?.close();
          server.close();
          viteServer?.close();
        },
        updateTree: (tree: ResourceNode) => {
          currentTree = tree;
          wsBroadcaster?.broadcast({
            type: "tree_update",
            tree: JSON.parse(JSON.stringify(tree, treeToJSON)),
          });
        },
        updateStatus: (status: DeploymentStatus) => {
          currentStatus = status;
          wsBroadcaster?.broadcast({ type: "status_update", status: status as DeployStatus });
        },
        updateResourceStatuses: (statuses: Record<string, string>) => {
          currentResourceStatuses = statuses;
          wsBroadcaster?.broadcast({
            type: "resource_statuses_bulk",
            statuses: statuses as Record<string, import("@react-pulumi/core").ResourceStatus>,
          });
        },
      };
      // Wire mutable handler references
      Object.defineProperty(vizServer, "onDeploy", {
        get: () => onDeploy,
        set: (v) => {
          onDeploy = v;
        },
      });
      Object.defineProperty(vizServer, "onPreview", {
        get: () => onPreview,
        set: (v) => {
          onPreview = v;
        },
      });
      Object.defineProperty(vizServer, "onRollback", {
        get: () => onRollback,
        set: (v) => {
          onRollback = v;
        },
      });
      Object.defineProperty(vizServer, "onInvoke", {
        get: () => onInvoke,
        set: (v) => {
          onInvoke = v;
        },
      });
      Object.defineProperty(vizServer, "onRerender", {
        get: () => onRerender,
        set: (v) => {
          onRerender = v;
        },
      });
      Object.defineProperty(vizServer, "onTimeTravel", {
        get: () => onTimeTravel,
        set: (v) => {
          onTimeTravel = v;
        },
      });
      resolve(vizServer);
    });
  });
}
