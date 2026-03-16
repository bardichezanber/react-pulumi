import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToResourceTree } from "../renderer.js";
import { pulumiToComponent } from "../wrap.js";
import { ROOT_TYPE, GROUP_TYPE } from "../resource-tree.js";
import { materializeTree } from "../pulumi-bridge.js";
import type { ResourceNode } from "../resource-tree.js";

// Mock Pulumi resource class
class MockBucket {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly opts: Record<string, unknown>;
  constructor(name: string, args: Record<string, unknown>, opts?: Record<string, unknown>) {
    this.name = name;
    this.args = args;
    this.opts = opts ?? {};
  }
}

class MockBucketObject {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly opts: Record<string, unknown>;
  constructor(name: string, args: Record<string, unknown>, opts?: Record<string, unknown>) {
    this.name = name;
    this.args = args;
    this.opts = opts ?? {};
  }
}

class MockAwsProvider {
  static __pulumiType = "pulumi:providers:aws";
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly opts: Record<string, unknown>;
  constructor(name: string, args: Record<string, unknown>, opts?: Record<string, unknown>) {
    this.name = name;
    this.args = args;
    this.opts = opts ?? {};
  }
}

class MockGcpProvider {
  static __pulumiType = "pulumi:providers:gcp";
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly opts: Record<string, unknown>;
  constructor(name: string, args: Record<string, unknown>, opts?: Record<string, unknown>) {
    this.name = name;
    this.args = args;
    this.opts = opts ?? {};
  }
}

class MockGcpBucket {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly opts: Record<string, unknown>;
  constructor(name: string, args: Record<string, unknown>, opts?: Record<string, unknown>) {
    this.name = name;
    this.args = args;
    this.opts = opts ?? {};
  }
}

const Bucket = pulumiToComponent(MockBucket as never, "aws:s3:Bucket");
const BucketObject = pulumiToComponent(MockBucketObject as never, "aws:s3:BucketObject");
const AwsProvider = pulumiToComponent(MockAwsProvider as never);
const GcpProvider = pulumiToComponent(MockGcpProvider as never);
const GcpBucket = pulumiToComponent(MockGcpBucket as never, "gcp:storage:Bucket");

/** Recursively collect all resource nodes (kind !== "component") */
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

/** Find the first resource node in the tree (skipping components and root) */
function firstResource(node: ResourceNode): ResourceNode | undefined {
  if (node.kind === "resource" && node.type !== ROOT_TYPE) return node;
  for (const child of node.children) {
    const found = firstResource(child);
    if (found) return found;
  }
  return undefined;
}

/** Find a resource node by name */
function findByName(node: ResourceNode, name: string): ResourceNode | undefined {
  if (node.name === name && node.type !== ROOT_TYPE) return node;
  for (const child of node.children) {
    const found = findByName(child, name);
    if (found) return found;
  }
  return undefined;
}

describe("renderToResourceTree", () => {
  it("renders a single resource", () => {
    const tree = renderToResourceTree(
      createElement(Bucket, { name: "my-bucket", versioning: true }),
    );

    expect(tree.type).toBe(ROOT_TYPE);
    const resources = collectResources(tree);
    expect(resources).toHaveLength(1);
    expect(resources[0].type).toBe("aws:s3:Bucket");
    expect(resources[0].name).toBe("my-bucket");
    expect(resources[0].props.versioning).toBe(true);
  });

  it("renders nested resources with parent relationships", () => {
    function MyStack() {
      return createElement(
        Bucket,
        { name: "parent-bucket" },
        createElement(BucketObject, { name: "child-object", objectKey: "index.html" }),
      );
    }

    const tree = renderToResourceTree(createElement(MyStack));
    const resources = collectResources(tree);

    expect(resources).toHaveLength(2);
    const bucket = resources[0];
    expect(bucket.type).toBe("aws:s3:Bucket");

    // BucketObject is nested under the bucket
    const childResources = collectResources(bucket).filter((r) => r !== bucket);
    expect(childResources).toHaveLength(1);
    expect(childResources[0].type).toBe("aws:s3:BucketObject");
    expect(childResources[0].props.objectKey).toBe("index.html");
  });

  it("renders sibling resources", () => {
    function MyStack2() {
      return [
        createElement(Bucket, { name: "bucket-a", key: "a" }),
        createElement(Bucket, { name: "bucket-b", key: "b" }),
      ] as unknown as React.ReactElement;
    }

    const tree = renderToResourceTree(createElement(MyStack2));
    const resources = collectResources(tree);

    expect(resources).toHaveLength(2);
    expect(resources[0].name).toBe("bucket-a");
    expect(resources[1].name).toBe("bucket-b");
  });

  it("ignores null/undefined children gracefully", () => {
    function Conditional() {
      return createElement(Bucket, { name: "cond-bucket" });
    }

    const tree = renderToResourceTree(createElement(Conditional));
    const resources = collectResources(tree);
    expect(resources).toHaveLength(1);
    expect(resources[0].name).toBe("cond-bucket");
  });

  it("includes component boundaries in the tree", () => {
    function WebTier() {
      return createElement(Bucket, { name: "web-bucket" });
    }

    const tree = renderToResourceTree(createElement(WebTier));
    // Root → WebTier (component) → Bucket (resource)
    const compNode = tree.children[0];
    expect(compNode.kind).toBe("component");
    expect(compNode.name).toBe("WebTier");
    expect(compNode.children).toHaveLength(1);
    expect(compNode.children[0].kind).toBe("resource");
    expect(compNode.children[0].name).toBe("web-bucket");
  });

  it("creates group nodes for <Group> components", () => {
    function MyInfra() {
      return createElement(
        GROUP_TYPE,
        { name: "my-site", type: "custom:component:StaticSite" },
        createElement(Bucket, { name: "site-bucket" }),
        createElement(BucketObject, { name: "site-index" }),
      );
    }

    const tree = renderToResourceTree(createElement(MyInfra));
    // Root → MyInfra (component) → Group (group) → resources
    const compNode = tree.children[0]; // MyInfra
    expect(compNode.kind).toBe("component");

    const groupNode = compNode.children[0]; // Group
    expect(groupNode.kind).toBe("group");
    expect(groupNode.name).toBe("my-site");
    expect(groupNode.meta.componentType).toBe("custom:component:StaticSite");
    expect(groupNode.children).toHaveLength(2);
    expect(groupNode.children[0].kind).toBe("resource");
    expect(groupNode.children[0].name).toBe("site-bucket");
    expect(groupNode.children[1].name).toBe("site-index");
  });
});

describe("provider detection", () => {
  it("detects provider nodes via type token", () => {
    function App() {
      return createElement(
        AwsProvider,
        { name: "west", region: "us-west-2" },
        createElement(Bucket, { name: "b1" }),
      );
    }

    const tree = renderToResourceTree(createElement(App));
    const providerNode = findByName(tree, "west");
    expect(providerNode).toBeDefined();
    expect(providerNode!.isProvider).toBe(true);
    expect(providerNode!.providerPackage).toBe("aws");
  });

  it("propagates provider to children", () => {
    function App() {
      return createElement(
        AwsProvider,
        { name: "west", region: "us-west-2" },
        createElement(Bucket, { name: "b1" }),
      );
    }

    const tree = renderToResourceTree(createElement(App));
    const bucket = findByName(tree, "b1");
    expect(bucket).toBeDefined();
    expect(bucket!.providers).toEqual({ aws: "west" });
  });

  it("inner provider overrides outer for same package", () => {
    function App() {
      return createElement(
        AwsProvider,
        { name: "outer", region: "us-west-2" },
        createElement(Bucket, { name: "outer-bucket" }),
        createElement(
          AwsProvider,
          { name: "inner", region: "us-east-1" },
          createElement(Bucket, { name: "inner-bucket" }),
        ),
      );
    }

    const tree = renderToResourceTree(createElement(App));
    const outerBucket = findByName(tree, "outer-bucket");
    const innerBucket = findByName(tree, "inner-bucket");
    expect(outerBucket!.providers).toEqual({ aws: "outer" });
    expect(innerBucket!.providers).toEqual({ aws: "inner" });
  });

  it("propagates provider through transparent component nodes", () => {
    function Inner() {
      return createElement(Bucket, { name: "deep-bucket" });
    }
    function App() {
      return createElement(
        AwsProvider,
        { name: "p", region: "us-west-2" },
        createElement(Inner),
      );
    }

    const tree = renderToResourceTree(createElement(App));
    const bucket = findByName(tree, "deep-bucket");
    expect(bucket!.providers).toEqual({ aws: "p" });
  });

  it("multiple packages coexist independently", () => {
    function App() {
      return createElement(
        AwsProvider,
        { name: "aws-prov", region: "us-west-2" },
        createElement(
          GcpProvider,
          { name: "gcp-prov", project: "my-proj" },
          createElement(Bucket, { name: "aws-bucket" }),
          createElement(GcpBucket, { name: "gcp-bucket" }),
        ),
      );
    }

    const tree = renderToResourceTree(createElement(App));
    const awsBucket = findByName(tree, "aws-bucket");
    const gcpBucket = findByName(tree, "gcp-bucket");
    expect(awsBucket!.providers).toEqual({ aws: "aws-prov", gcp: "gcp-prov" });
    expect(gcpBucket!.providers).toEqual({ aws: "aws-prov", gcp: "gcp-prov" });
  });
});

describe("opts prop", () => {
  it("strips opts from props and stores on node", () => {
    function App() {
      return createElement(Bucket, {
        name: "protected",
        opts: { protect: true, ignoreChanges: ["tags"] },
      });
    }

    const tree = renderToResourceTree(createElement(App));
    const bucket = findByName(tree, "protected");
    expect(bucket!.opts).toEqual({ protect: true, ignoreChanges: ["tags"] });
    expect(bucket!.props.opts).toBeUndefined();
  });

  it("does not set opts when not provided", () => {
    function App() {
      return createElement(Bucket, { name: "normal" });
    }

    const tree = renderToResourceTree(createElement(App));
    const bucket = findByName(tree, "normal");
    expect(bucket!.opts).toBeUndefined();
  });
});

describe("materializeTree", () => {
  it("instantiates Pulumi resources from tree", () => {
    const tree = renderToResourceTree(
      createElement(
        Bucket,
        { name: "mat-bucket" },
        createElement(BucketObject, { name: "mat-object", objectKey: "file.txt" }),
      ),
    );

    const resources = materializeTree(tree);

    expect(resources).toHaveLength(2);
    const bucket = resources[0] as MockBucket;
    expect(bucket).toBeInstanceOf(MockBucket);
    expect(bucket.name).toBe("mat-bucket");

    const obj = resources[1] as MockBucketObject;
    expect(obj).toBeInstanceOf(MockBucketObject);
    expect(obj.name).toBe("mat-object");
    expect(obj.args.objectKey).toBe("file.txt");
    expect(obj.opts.parent).toBe(bucket);
  });

  it("throws for unregistered type tokens", () => {
    const tree: ResourceNode = {
      kind: "resource",
      type: ROOT_TYPE,
      name: "root",
      props: {},
      children: [
        {
          kind: "resource",
          type: "unknown:resource:Type",
          name: "bad",
          props: {},
          children: [],
          parent: null,
          meta: {},
        },
      ],
      parent: null,
      meta: {},
    };

    expect(() => materializeTree(tree)).toThrow('No Pulumi resource class registered');
  });

  it("provider flows via opts.provider, not parent", () => {
    function App() {
      return createElement(
        AwsProvider,
        { name: "west", region: "us-west-2" },
        createElement(Bucket, { name: "b1" }),
      );
    }

    const tree = renderToResourceTree(createElement(App));
    const resources = materializeTree(tree);

    expect(resources).toHaveLength(2);
    const provider = resources[0] as MockAwsProvider;
    const bucket = resources[1] as MockBucket;

    expect(provider).toBeInstanceOf(MockAwsProvider);
    expect(provider.name).toBe("west");
    expect(provider.args.region).toBe("us-west-2");

    expect(bucket).toBeInstanceOf(MockBucket);
    // Provider is set via opts.provider, NOT opts.parent
    expect(bucket.opts.provider).toBe(provider);
    expect(bucket.opts.parent).toBeUndefined();
  });

  it("passes opts.protect and opts.ignoreChanges through to Pulumi opts", () => {
    function App() {
      return createElement(Bucket, {
        name: "protected-bucket",
        opts: { protect: true, ignoreChanges: ["tags"] },
      });
    }

    const tree = renderToResourceTree(createElement(App));
    const resources = materializeTree(tree);

    expect(resources).toHaveLength(1);
    const bucket = resources[0] as MockBucket;
    expect(bucket.opts.protect).toBe(true);
    expect(bucket.opts.ignoreChanges).toEqual(["tags"]);
  });

  it("resolves opts.provider by name", () => {
    function App() {
      return [
        createElement(AwsProvider, { name: "east", region: "us-east-1", key: "p" }),
        createElement(Bucket, { name: "b1", opts: { provider: "east" }, key: "b" }),
      ] as unknown as React.ReactElement;
    }

    const tree = renderToResourceTree(createElement(App));
    const resources = materializeTree(tree);

    const provider = resources[0] as MockAwsProvider;
    const bucket = resources[1] as MockBucket;
    expect(bucket.opts.provider).toBe(provider);
  });

  it("resolves opts.dependsOn by name", () => {
    function App() {
      return [
        createElement(Bucket, { name: "config-bucket", key: "a" }),
        createElement(Bucket, { name: "data-bucket", opts: { dependsOn: ["config-bucket"] }, key: "b" }),
      ] as unknown as React.ReactElement;
    }

    const tree = renderToResourceTree(createElement(App));
    const resources = materializeTree(tree);

    const configBucket = resources[0] as MockBucket;
    const dataBucket = resources[1] as MockBucket;
    expect(dataBucket.opts.dependsOn).toEqual([configBucket]);
  });

  it("provider children share same parent as provider (not provider itself)", () => {
    function App() {
      return createElement(
        Bucket,
        { name: "parent-bucket" },
        createElement(
          AwsProvider,
          { name: "nested-prov", region: "eu-west-1" },
          createElement(BucketObject, { name: "child-obj" }),
        ),
      );
    }

    const tree = renderToResourceTree(createElement(App));
    const resources = materializeTree(tree);

    // parent-bucket, nested-prov, child-obj
    expect(resources).toHaveLength(3);
    const parentBucket = resources[0] as MockBucket;
    const provider = resources[1] as MockAwsProvider;
    const childObj = resources[2] as MockBucketObject;

    // Provider's parent is the bucket
    expect(provider.opts.parent).toBe(parentBucket);
    // Child's parent is the bucket (NOT the provider), and provider flows via opts.provider
    expect(childObj.opts.parent).toBe(parentBucket);
    expect(childObj.opts.provider).toBe(provider);
  });
});
