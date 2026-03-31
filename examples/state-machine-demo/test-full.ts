import { renderToResourceTree, vizRegistry } from "@react-pulumi/core";
import { createElement } from "react";

// Import and test if the module loads
const mod = await import("./index.js");
console.log("[DEBUG] Module loaded. default export:", typeof mod.default);

const App = mod.default;
vizRegistry.reset();

try {
  renderToResourceTree(createElement(App));
} catch (err) {
  console.log("[DEBUG] Render error:", err);
}

console.log("[DEBUG] vizRegistry.size:", vizRegistry.size);
console.log("[DEBUG] Controls:", JSON.stringify(vizRegistry.list(), null, 2));
