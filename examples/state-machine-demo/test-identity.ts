import { pulumiToComponent, renderToResourceTree, VizInput, vizRegistry } from "@react-pulumi/core";
import { createElement, useState } from "react";

class MockVpc {
  static __pulumiType = "aws:ec2/vpc:Vpc";
  name: string;
  args: Record<string, unknown>;
  constructor(name: string, args: Record<string, unknown>) {
    this.name = name;
    this.args = args;
  }
}
const [_Vpc] = pulumiToComponent(MockVpc as never);

// Directly import the example's VizInput reference
const exMod = await import("./index.js");
const ExApp = exMod.default;

// Test: does the example's module get the same VizInput?
// Simple inline app using OUR VizInput reference
function SimpleApp() {
  const [n, setN] = useState(1);
  return createElement(VizInput, {
    name: "test",
    inputType: "number",
    value: n,
    setValue: setN,
  } as any);
}

vizRegistry.reset();
renderToResourceTree(createElement(SimpleApp));
console.log("[SimpleApp] vizRegistry.size:", vizRegistry.size);

// Now test with the example's App
vizRegistry.reset();
renderToResourceTree(createElement(ExApp));
console.log("[ExampleApp] vizRegistry.size:", vizRegistry.size);

// Check if the example might use a different vizRegistry
import { vizRegistry as vr2 } from "@react-pulumi/core";

console.log("[Identity] vizRegistry === vr2:", vizRegistry === vr2);
