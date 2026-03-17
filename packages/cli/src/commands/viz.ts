import { resolve } from "node:path";
import { createElement } from "react";

interface VizOptions {
  port: string;
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

  const { renderToResourceTree } = await import("@react-pulumi/core");
  const { startVizServer } = await import("@react-pulumi/viz");

  const element = createElement(App);
  const tree = renderToResourceTree(element);

  console.log(`[react-pulumi] Starting viz server on http://localhost:${port}`);

  const server = await startVizServer({ port, tree });

  console.log(`[react-pulumi] Viz dashboard ready at http://localhost:${server.port}`);

  // Keep the process alive
  process.on("SIGINT", () => {
    console.log("\n[react-pulumi] Shutting down viz server...");
    server.close();
    process.exit(0);
  });
}
