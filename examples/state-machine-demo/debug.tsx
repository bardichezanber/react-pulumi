import { pulumiToComponent, VizButton, VizInput, vizRegistry } from "@react-pulumi/core";
import { createElement, useState } from "react";

class Mock {
  name: string;
  args: Record<string, unknown>;
  constructor(n: string, a: Record<string, unknown>) {
    this.name = n;
    this.args = a;
  }
}
const [Res] = pulumiToComponent(Mock as never, "test:R");

export default function App() {
  const [count, setCount] = useState(2);
  console.log("[DEBUG] App render, count:", count, "vizRegistry.size:", vizRegistry.size);
  return createElement(
    "div",
    null,
    createElement(VizInput, {
      name: "count",
      inputType: "number" as const,
      value: count,
      setValue: setCount,
    }),
    createElement(VizButton, {
      name: "up",
      label: "Up",
      handler: () => setCount((n: number) => n + 1),
    }),
    createElement(Res, { name: "r1" }),
  );
}
