import { describe, it, expect, beforeEach } from "vitest";
import { createElement, useState, useMemo, useRef, useCallback } from "react";
import { renderToResourceTree, collectHookKeys } from "../renderer.js";
import { pulumiToComponent } from "../wrap.js";
import { installInterceptor } from "../state-interceptor.js";
import { loadState, collectState, resetState } from "../state-store.js";
import type { ResourceNode } from "../resource-tree.js";
import { ROOT_TYPE } from "../resource-tree.js";

// Mock resource
class MockInstance {
  readonly name: string;
  readonly args: Record<string, unknown>;
  constructor(name: string, args: Record<string, unknown>) {
    this.name = name;
    this.args = args;
  }
}

const Instance = pulumiToComponent(MockInstance as never, "aws:ec2:Instance");

/** Recursively collect all resource nodes */
function collectResources(node: ResourceNode): ResourceNode[] {
  const result: ResourceNode[] = [];
  if (node.kind === "resource" && node.type !== ROOT_TYPE) {
    result.push(node);
  }
  for (const child of node.children) {
    result.push(...collectResources(child));
  }
  return result;
}

beforeEach(() => {
  resetState();
});

describe("state-interceptor", () => {
  it("useState returns persisted value instead of default", () => {
    loadState({ keys: ["App:0"], values: [5] });

    const cleanup = installInterceptor();

    function App() {
      const [count] = useState(1);
      return Array.from({ length: count }, (_, i) =>
        createElement(Instance, { key: i, name: `web-${i}`, instanceType: "t3.micro" }),
      ) as unknown as React.ReactElement;
    }

    const tree = renderToResourceTree(createElement(App));
    cleanup();

    const resources = collectResources(tree);
    expect(resources).toHaveLength(5); // persisted value is 5, not default 1
  });

  it("useState returns default when no persisted state", () => {
    loadState({ keys: [], values: [] });

    const cleanup = installInterceptor();

    function App() {
      const [count] = useState(3);
      return Array.from({ length: count }, (_, i) =>
        createElement(Instance, { key: i, name: `web-${i}`, instanceType: "t3.micro" }),
      ) as unknown as React.ReactElement;
    }

    const tree = renderToResourceTree(createElement(App));
    cleanup();

    const resources = collectResources(tree);
    expect(resources).toHaveLength(3); // default value
  });

  it("cleanup restores original useState behavior", () => {
    loadState({ keys: ["App:0"], values: [10] });

    const cleanup = installInterceptor();
    cleanup();

    // Reset for fresh render
    resetState();
    loadState({ keys: [], values: [] });

    function App() {
      const [count] = useState(2);
      return Array.from({ length: count }, (_, i) =>
        createElement(Instance, { key: i, name: `web-${i}`, instanceType: "t3.micro" }),
      ) as unknown as React.ReactElement;
    }

    const tree = renderToResourceTree(createElement(App));
    const resources = collectResources(tree);
    expect(resources).toHaveLength(2); // default, not intercepted
  });

  it("handles multiple useState hooks in one component", () => {
    loadState({ keys: ["App:0", "App:1"], values: [3, "t3.large"] });

    const cleanup = installInterceptor();

    function App() {
      const [count] = useState(1);
      const [type] = useState("t3.micro");
      return Array.from({ length: count }, (_, i) =>
        createElement(Instance, { key: i, name: `web-${i}`, instanceType: type }),
      ) as unknown as React.ReactElement;
    }

    const tree = renderToResourceTree(createElement(App));
    cleanup();

    const resources = collectResources(tree);
    expect(resources).toHaveLength(3);
    expect(resources[0].props.instanceType).toBe("t3.large");
  });

  it("handles useState with lazy initializer function", () => {
    loadState({ keys: ["App:0"], values: [7] });

    const cleanup = installInterceptor();

    function App() {
      const [count] = useState(() => 2); // lazy init
      return Array.from({ length: count }, (_, i) =>
        createElement(Instance, { key: i, name: `web-${i}`, instanceType: "t3.micro" }),
      ) as unknown as React.ReactElement;
    }

    const tree = renderToResourceTree(createElement(App));
    cleanup();

    const resources = collectResources(tree);
    expect(resources).toHaveLength(7); // persisted, not lazy default
  });

  it("does not interfere with useMemo", () => {
    loadState({ keys: ["App:0"], values: [4] });

    const cleanup = installInterceptor();

    function App() {
      const [count] = useState(1);
      const doubled = useMemo(() => count * 2, [count]);
      return Array.from({ length: doubled }, (_, i) =>
        createElement(Instance, { key: i, name: `web-${i}`, instanceType: "t3.micro" }),
      ) as unknown as React.ReactElement;
    }

    const tree = renderToResourceTree(createElement(App));
    cleanup();

    const resources = collectResources(tree);
    // count=4 (persisted), doubled=8
    expect(resources).toHaveLength(8);
  });

  it("does not interfere with useRef", () => {
    loadState({ keys: ["App:0"], values: [2] });

    const cleanup = installInterceptor();

    function App() {
      const [count] = useState(1);
      const ref = useRef("hello");
      return Array.from({ length: count }, (_, i) =>
        createElement(Instance, { key: i, name: `web-${i}`, instanceType: ref.current }),
      ) as unknown as React.ReactElement;
    }

    const tree = renderToResourceTree(createElement(App));
    cleanup();

    const resources = collectResources(tree);
    expect(resources).toHaveLength(2);
    expect(resources[0].props.instanceType).toBe("hello");
  });

  it("handles persisted boolean state", () => {
    loadState({ keys: ["App:0"], values: [true] });

    const cleanup = installInterceptor();

    function App() {
      const [enabled] = useState(false);
      if (!enabled) return null;
      return createElement(Instance, { name: "web-0", instanceType: "t3.micro" });
    }

    const tree = renderToResourceTree(createElement(App));
    cleanup();

    const resources = collectResources(tree);
    expect(resources).toHaveLength(1); // enabled=true from persisted
  });

  it("handles persisted string state", () => {
    loadState({ keys: ["App:0"], values: ["us-west-2"] });

    const cleanup = installInterceptor();

    function App() {
      const [region] = useState("us-east-1");
      return createElement(Instance, { name: "web-0", region });
    }

    const tree = renderToResourceTree(createElement(App));
    cleanup();

    const resources = collectResources(tree);
    expect(resources[0].props.region).toBe("us-west-2");
  });
});

describe("collectHookKeys", () => {
  it("extracts useState keys from fiber tree", () => {
    loadState({ keys: [], values: [] });
    const cleanup = installInterceptor();

    function App() {
      const [count] = useState(2);
      const [type] = useState("t3.micro");
      return Array.from({ length: count }, (_, i) =>
        createElement(Instance, { key: i, name: `web-${i}`, instanceType: type }),
      ) as unknown as React.ReactElement;
    }

    const { fiberRoot } = renderToResourceTree(createElement(App), {
      returnFiberRoot: true,
    });
    cleanup();

    const keys = collectHookKeys(fiberRoot);
    expect(keys).toEqual(["App:0", "App:1"]);
  });

  it("collects keys from nested components", () => {
    loadState({ keys: [], values: [] });
    const cleanup = installInterceptor();

    function Inner() {
      const [size] = useState("large");
      return createElement(Instance, { name: "inner", instanceType: size });
    }

    function App() {
      const [count] = useState(1);
      return createElement(Inner);
    }

    const { fiberRoot } = renderToResourceTree(createElement(App), {
      returnFiberRoot: true,
    });
    cleanup();

    const keys = collectHookKeys(fiberRoot);
    // App has 1 useState, Inner has 1 useState
    expect(keys).toEqual(["App:0", "Inner:0"]);
  });

  it("returns empty array when component has no useState", () => {
    function App() {
      return createElement(Instance, { name: "web-0", instanceType: "t3.micro" });
    }

    const { fiberRoot } = renderToResourceTree(createElement(App), {
      returnFiberRoot: true,
    });

    const keys = collectHookKeys(fiberRoot);
    expect(keys).toEqual([]);
  });

  it("distinguishes useState from useMemo/useCallback in key counting", () => {
    loadState({ keys: [], values: [] });
    const cleanup = installInterceptor();

    function App() {
      const [count] = useState(2);
      const _memo = useMemo(() => count * 2, [count]);
      const [label] = useState("prod");
      const _cb = useCallback(() => {}, []);
      return createElement(Instance, { name: "web-0", instanceType: label });
    }

    const { fiberRoot } = renderToResourceTree(createElement(App), {
      returnFiberRoot: true,
    });
    cleanup();

    const keys = collectHookKeys(fiberRoot);
    // Only useState hooks should be keyed, not useMemo/useCallback
    expect(keys).toEqual(["App:0", "App:1"]);
  });

  it("handles sibling components each with their own hooks", () => {
    loadState({ keys: [], values: [] });
    const cleanup = installInterceptor();

    function Left() {
      const [a] = useState(1);
      return createElement(Instance, { name: "left", instanceType: `${a}` });
    }

    function Right() {
      const [b] = useState(2);
      const [c] = useState(3);
      return createElement(Instance, { name: "right", instanceType: `${b}-${c}` });
    }

    function App() {
      return [
        createElement(Left, { key: "l" }),
        createElement(Right, { key: "r" }),
      ] as unknown as React.ReactElement;
    }

    const { fiberRoot } = renderToResourceTree(createElement(App), {
      returnFiberRoot: true,
    });
    cleanup();

    const keys = collectHookKeys(fiberRoot);
    expect(keys).toEqual(["Left:0", "Right:0", "Right:1"]);
  });
});
