import { createElement, useState } from "react";
import { renderToResourceTree, pulumiToComponent, vizRegistry, VizInput } from "@react-pulumi/core";

class MockVpc {
  static __pulumiType = "aws:ec2/vpc:Vpc";
  name: string;
  args: Record<string, unknown>;
  constructor(name: string, args: Record<string, unknown>) {
    this.name = name;
    this.args = args;
    console.log("[DEBUG] MockVpc constructed:", name);
  }
}

const [Vpc] = pulumiToComponent(MockVpc as never);

// Test 1: Just VizInput at root level
function App1() {
  const [count, setCount] = useState(2);
  console.log("[DEBUG] App1 rendered");
  return createElement(VizInput, { name: "count", inputType: "number", value: count, setValue: setCount } as any);
}

vizRegistry.reset();
renderToResourceTree(createElement(App1));
console.log("[Test 1] VizInput alone:", vizRegistry.size, "controls");

// Test 2: VizInput inside Vpc
vizRegistry.reset();
function App2() {
  const [count, setCount] = useState(2);
  console.log("[DEBUG] App2 rendered");
  return createElement(Vpc, { name: "test-vpc" },
    createElement(VizInput, { name: "count2", inputType: "number", value: count, setValue: setCount } as any),
  );
}

renderToResourceTree(createElement(App2));
console.log("[Test 2] VizInput inside Vpc:", vizRegistry.size, "controls");

// Test 3: VizInput + Fragment
vizRegistry.reset();
function App3() {
  const [count, setCount] = useState(2);
  console.log("[DEBUG] App3 rendered");
  return createElement("div", null,
    createElement(VizInput, { name: "count3", inputType: "number", value: count, setValue: setCount } as any),
  );
}

renderToResourceTree(createElement(App3));
console.log("[Test 3] VizInput in div:", vizRegistry.size, "controls");
