import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Replace node: built-in imports with empty stubs for the browser bundle.
 * This is needed because @react-pulumi/core's render-to-pulumi.ts imports
 * node:crypto and action-log-middleware.ts imports node:fs + node:path.
 * These modules are only used server-side; the browser client never executes
 * those code paths (it only uses types, store, and UI components).
 */
function stubNodeBuiltins(): Plugin {
  const nodeModules = ["node:crypto", "node:fs", "node:path", "node:os", "node:child_process"];
  const stubId = "\0node-stub";

  return {
    name: "stub-node-builtins",
    enforce: "pre",
    resolveId(source) {
      if (nodeModules.includes(source)) return stubId;
      return null;
    },
    load(id) {
      if (id === stubId) {
        // Export stubs for all named exports that core modules use
        return `
          export default {};
          export const randomUUID = () => 'stub';
          export const readFileSync = () => '';
          export const writeFileSync = () => {};
          export const mkdirSync = () => {};
          export const existsSync = () => false;
          export const join = (...args) => args.join('/');
          export const dirname = (p) => p;
          export const resolve = (...args) => args.join('/');
          export const tmpdir = () => '/tmp';
        `;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [react(), stubNodeBuiltins()],
  root: resolve(__dirname),
  build: {
    outDir: "dist/client",
    emptyDir: true,
  },
});
