import { createElement, useState } from "react";
import { renderToResourceTree, pulumiToComponent, vizRegistry, VizInput, VizButton } from "@react-pulumi/core";

class Mock {
  name: string;
  args: Record<string, unknown>;
  constructor(n: string, a: Record<string, unknown>) { this.name = n; this.args = a; }
}
const [Res] = pulumiToComponent(Mock as never, "test:Res");

function App() {
  const [count, setCount] = useState(2);
  console.log("[DEBUG] App rendered, count =", count);
  return createElement("div", null,
    createElement(VizInput, { name: "replicas", inputType: "number", value: count, setValue: setCount } as any),
    createElement(VizButton, { name: "go", label: "Go", handler: () => {} } as any),
    createElement(Res, { name: "r1" }),
  );
}

vizRegistry.reset();
console.log("[DEBUG] Before render, vizRegistry.size:", vizRegistry.size);
renderToResourceTree(createElement(App));
console.log("[DEBUG] After render, vizRegistry.size:", vizRegistry.size);
console.log("[DEBUG] Controls:", JSON.stringify(vizRegistry.list()));
