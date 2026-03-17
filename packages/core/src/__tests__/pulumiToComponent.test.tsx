import { createElement, useContext } from "react";
import { describe, expect, it } from "vitest";
import { renderToResourceTree } from "../renderer.js";
import { pulumiToComponent } from "../wrap.js";

// ── Mock Pulumi resource classes ──

class MockVcn {
  static __pulumiType = "oci:core:Vcn";
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly opts: Record<string, unknown>;
  readonly id = "vcn-mock-id";
  constructor(name: string, args: Record<string, unknown>, opts?: Record<string, unknown>) {
    this.name = name;
    this.args = args;
    this.opts = opts ?? {};
  }
}

class MockSubnet {
  static __pulumiType = "oci:core:Subnet";
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly opts: Record<string, unknown>;
  readonly id = "subnet-mock-id";
  constructor(name: string, args: Record<string, unknown>, opts?: Record<string, unknown>) {
    this.name = name;
    this.args = args;
    this.opts = opts ?? {};
  }
}

class MockInstance {
  static __pulumiType = "oci:core:Instance";
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly opts: Record<string, unknown>;
  constructor(name: string, args: Record<string, unknown>, opts?: Record<string, unknown>) {
    this.name = name;
    this.args = args;
    this.opts = opts ?? {};
  }
}

describe("pulumiToComponent returns [Component, Context]", () => {
  it("returns a tuple of [FC, Context]", () => {
    const result = pulumiToComponent(MockVcn as never);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(typeof result[0]).toBe("function");
    expect(result[1]).toBeDefined();
    // Context has Provider and Consumer
    expect(result[1].Provider).toBeDefined();
    expect(result[1].Consumer).toBeDefined();
  });

  it("component has displayName set to type token", () => {
    const [Vcn] = pulumiToComponent(MockVcn as never);
    expect(Vcn.displayName).toBe("oci:core:Vcn");
  });

  it("accepts explicit typeToken", () => {
    const [Comp] = pulumiToComponent(MockVcn as never, "custom:mod:Vcn");
    expect(Comp.displayName).toBe("custom:mod:Vcn");
  });

  it("throws when type token cannot be determined", () => {
    class NoType {}
    expect(() => pulumiToComponent(NoType as never)).toThrow("Cannot determine type token");
  });
});

describe("render-time resource creation", () => {
  it("creates Pulumi resource during render", () => {
    const instances: MockVcn[] = [];
    class TrackingVcn {
      static __pulumiType = "test:track:Vcn";
      readonly name: string;
      readonly args: Record<string, unknown>;
      readonly opts: Record<string, unknown>;
      constructor(name: string, args: Record<string, unknown>, opts?: Record<string, unknown>) {
        this.name = name;
        this.args = args;
        this.opts = opts ?? {};
        instances.push(this as unknown as MockVcn);
      }
    }

    const [Vcn] = pulumiToComponent(TrackingVcn as never);

    renderToResourceTree(createElement(Vcn, { name: "my-vcn", cidrBlock: "10.0.0.0/16" }));

    expect(instances).toHaveLength(1);
    expect(instances[0].name).toBe("my-vcn");
    expect(instances[0].args.cidrBlock).toBe("10.0.0.0/16");
  });

  it("uses type token as default name when name prop is omitted", () => {
    const instances: Array<{ name: string }> = [];
    class TrackingRes {
      static __pulumiType = "test:track:Default";
      readonly name: string;
      constructor(name: string, _args: Record<string, unknown>) {
        this.name = name;
        instances.push(this);
      }
    }

    const [Res] = pulumiToComponent(TrackingRes as never);
    renderToResourceTree(createElement(Res, {}));

    expect(instances).toHaveLength(1);
    expect(instances[0].name).toBe("test:track:Default");
  });

  it("passes opts to resource constructor", () => {
    const instances: MockVcn[] = [];
    class TrackingVcn2 {
      static __pulumiType = "test:track:Vcn2";
      readonly name: string;
      readonly args: Record<string, unknown>;
      readonly opts: Record<string, unknown>;
      constructor(name: string, args: Record<string, unknown>, opts?: Record<string, unknown>) {
        this.name = name;
        this.args = args;
        this.opts = opts ?? {};
        instances.push(this as unknown as MockVcn);
      }
    }

    const [Vcn] = pulumiToComponent(TrackingVcn2 as never);

    renderToResourceTree(
      createElement(Vcn, {
        name: "my-vcn",
        cidrBlock: "10.0.0.0/16",
        opts: { protect: true },
      }),
    );

    expect(instances).toHaveLength(1);
    expect(instances[0].opts.protect).toBe(true);
  });
});

describe("Context — useContext reads ancestor instance", () => {
  it("provides instance to descendants via Context", () => {
    const [Vcn, VcnCtx] = pulumiToComponent(MockVcn as never);

    let capturedVcn: MockVcn | null = null;

    function SubnetLayer() {
      capturedVcn = useContext(VcnCtx) as MockVcn;
      return null;
    }

    renderToResourceTree(
      createElement(Vcn, { name: "main", cidrBlock: "10.0.0.0/16" }, createElement(SubnetLayer)),
    );

    expect(capturedVcn).not.toBeNull();
    expect(capturedVcn!.name).toBe("main");
    expect(capturedVcn!.args.cidrBlock).toBe("10.0.0.0/16");
  });

  it("nested instances — inner overrides outer (Context scoping)", () => {
    const [Vcn, VcnCtx] = pulumiToComponent(MockVcn as never);

    let outerCaptured: MockVcn | null = null;
    let innerCaptured: MockVcn | null = null;

    function OuterChild() {
      outerCaptured = useContext(VcnCtx) as MockVcn;
      return null;
    }

    function InnerChild() {
      innerCaptured = useContext(VcnCtx) as MockVcn;
      return null;
    }

    function App() {
      return createElement(
        Vcn,
        { name: "outer", cidrBlock: "10.1.0.0/16" },
        createElement(OuterChild),
        createElement(Vcn, { name: "inner", cidrBlock: "10.2.0.0/16" }, createElement(InnerChild)),
      );
    }

    renderToResourceTree(createElement(App));

    expect(outerCaptured!.name).toBe("outer");
    expect(innerCaptured!.name).toBe("inner");
  });

  it("sibling instances have isolated Context", () => {
    const [Vcn, VcnCtx] = pulumiToComponent(MockVcn as never);

    const captured: string[] = [];

    function Reader({ label }: { label: string }) {
      const vcn = useContext(VcnCtx) as MockVcn;
      captured.push(`${label}:${vcn.name}`);
      return null;
    }

    function App() {
      return [
        createElement(
          Vcn,
          { name: "vpc-prod", key: "prod", cidrBlock: "10.1.0.0/16" },
          createElement(Reader, { label: "prod" }),
        ),
        createElement(
          Vcn,
          { name: "vpc-staging", key: "staging", cidrBlock: "10.2.0.0/16" },
          createElement(Reader, { label: "staging" }),
        ),
      ] as unknown as React.ReactElement;
    }

    renderToResourceTree(createElement(App));

    expect(captured).toContain("prod:vpc-prod");
    expect(captured).toContain("staging:vpc-staging");
  });

  it("default Context value is null when no ancestor Provider", () => {
    const [, VcnCtx] = pulumiToComponent(MockVcn as never);

    let captured: unknown = "not-set";

    function Orphan() {
      captured = useContext(VcnCtx);
      return null;
    }

    renderToResourceTree(createElement(Orphan));

    expect(captured).toBeNull();
  });
});

describe("render props mode", () => {
  it("passes instance to render prop function", () => {
    const [Vcn] = pulumiToComponent(MockVcn as never);
    const [_Subnet] = pulumiToComponent(MockSubnet as never);

    const subnetInstances: MockSubnet[] = [];
    class TrackingSubnet {
      static __pulumiType = "test:track:Subnet";
      readonly name: string;
      readonly args: Record<string, unknown>;
      readonly opts: Record<string, unknown>;
      constructor(name: string, args: Record<string, unknown>, opts?: Record<string, unknown>) {
        this.name = name;
        this.args = args;
        this.opts = opts ?? {};
        subnetInstances.push(this as unknown as MockSubnet);
      }
    }

    const [TrackedSubnet] = pulumiToComponent(TrackingSubnet as never);

    let receivedVcn: MockVcn | null = null;

    renderToResourceTree(
      createElement(Vcn, { name: "main", cidrBlock: "10.0.0.0/16" }, (vcn: MockVcn) => {
        receivedVcn = vcn;
        return createElement(TrackedSubnet, { name: "pub", vcnId: vcn.id });
      }),
    );

    expect(receivedVcn).not.toBeNull();
    expect(receivedVcn!.name).toBe("main");
    expect(subnetInstances).toHaveLength(1);
    expect(subnetInstances[0].args.vcnId).toBe("vcn-mock-id");
  });

  it("render props also provides Context to deeper descendants", () => {
    const [Vcn, VcnCtx] = pulumiToComponent(MockVcn as never);

    let contextVcn: MockVcn | null = null;

    function DeepChild() {
      contextVcn = useContext(VcnCtx) as MockVcn;
      return null;
    }

    renderToResourceTree(
      createElement(Vcn, { name: "main", cidrBlock: "10.0.0.0/16" }, (_vcn: MockVcn) =>
        createElement(DeepChild),
      ),
    );

    expect(contextVcn).not.toBeNull();
    expect(contextVcn!.name).toBe("main");
  });
});

describe("cross-resource Output wiring", () => {
  it("enables passing Output from ancestor to descendant props", () => {
    const [Vcn, VcnCtx] = pulumiToComponent(MockVcn as never);

    const subnetInstances: Array<{ name: string; args: Record<string, unknown> }> = [];
    class TrackingSubnet2 {
      static __pulumiType = "test:track:Subnet2";
      readonly name: string;
      readonly args: Record<string, unknown>;
      constructor(name: string, args: Record<string, unknown>) {
        this.name = name;
        this.args = args;
        subnetInstances.push(this);
      }
    }

    const [Subnet] = pulumiToComponent(TrackingSubnet2 as never);

    function SubnetLayer() {
      const vcn = useContext(VcnCtx) as MockVcn;
      return createElement(Subnet, { name: "pub", vcnId: vcn.id, cidrBlock: "10.0.0.0/20" });
    }

    function App() {
      return createElement(
        Vcn,
        { name: "main", cidrBlock: "10.0.0.0/16" },
        createElement(SubnetLayer),
      );
    }

    renderToResourceTree(createElement(App));

    expect(subnetInstances).toHaveLength(1);
    expect(subnetInstances[0].args.vcnId).toBe("vcn-mock-id");
  });
});

describe("leaf resources — Context can be ignored", () => {
  it("works without using Context (destructure only first element)", () => {
    const instances: Array<{ name: string }> = [];
    class TrackingInstance {
      static __pulumiType = "test:track:Instance";
      readonly name: string;
      constructor(name: string, _args: Record<string, unknown>) {
        this.name = name;
        instances.push(this);
      }
    }

    const [Instance] = pulumiToComponent(TrackingInstance as never);

    renderToResourceTree(createElement(Instance, { name: "web-0", instanceType: "t3.micro" }));

    expect(instances).toHaveLength(1);
    expect(instances[0].name).toBe("web-0");
  });
});
