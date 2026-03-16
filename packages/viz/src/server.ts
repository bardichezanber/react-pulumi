import { createServer as createHttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResourceNode } from "@react-pulumi/core";
import type { DeploymentStatus } from "./store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface VizServerOptions {
  port: number;
  tree: ResourceNode;
  status?: DeploymentStatus;
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
}

export async function startVizServer(
  opts: VizServerOptions,
): Promise<VizServer> {
  let currentTree = opts.tree;
  let currentStatus: DeploymentStatus = opts.status ?? "idle";

  // In production (published), serve pre-built client from dist/client/
  // In dev, fall back to Vite dev server
  const clientDir = join(__dirname, "client");

  let mode: "static" | "vite" = "static";
  let viteServer: { middlewares: { handle: Function }; close: () => Promise<void> } | null = null;

  try {
    await readFile(join(clientDir, "index.html"), "utf-8");
  } catch {
    // No pre-built client; try Vite dev server
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
    const url = new URL(req.url ?? "/", `http://localhost:${opts.port}`);

    // API endpoint for tree data
    if (url.pathname === "/api/tree") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ tree: currentTree, status: currentStatus }, treeToJSON));
      return;
    }

    if (mode === "vite" && viteServer) {
      // Delegate to Vite dev server middleware
      viteServer.middlewares.handle(req, res);
      return;
    }

    // Static file serving from pre-built client
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
      res.writeHead(200, {
        "Content-Type": mimeTypes[ext] ?? "application/octet-stream",
      });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(opts.port, () => {
      resolve({
        port: opts.port,
        close: () => {
          server.close();
          viteServer?.close();
        },
        updateTree: (tree: ResourceNode) => {
          currentTree = tree;
        },
        updateStatus: (status: DeploymentStatus) => {
          currentStatus = status;
        },
      });
    });
  });
}
