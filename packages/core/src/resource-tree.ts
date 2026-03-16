export interface ResourceMeta {
  /**
   * Tracks which React component created this node, useful for viz/debugging.
   */
  createdBy?: string;
  [key: string]: unknown;
}

export interface ResourceNode {
  /** Whether this is a real Pulumi resource, a React component group, a ComponentResource group, or an action */
  kind: "resource" | "component" | "group" | "action";
  /** Pulumi type token, e.g. "aws:ec2:Instance", or component name */
  type: string;
  /** Logical name for the resource */
  name: string;
  /** Resource input properties */
  props: Record<string, unknown>;
  /** Child resources */
  children: ResourceNode[];
  /** Parent resource (set during tree manipulation) */
  parent: ResourceNode | null;
  /** Provider instances available to this resource, keyed by package name */
  providers?: Record<string, string>;
  /** Explicit resource options from JSX opts prop */
  opts?: Record<string, unknown>;
  /** True if this node is a Pulumi provider resource */
  isProvider?: boolean;
  /** Package name for provider nodes (e.g. "aws") */
  providerPackage?: string;
  /** Extra metadata */
  meta: ResourceMeta;
}

export function createResourceNode(
  type: string,
  name: string,
  props: Record<string, unknown>,
): ResourceNode {
  return {
    kind: "resource",
    type,
    name,
    props,
    children: [],
    parent: null,
    meta: {},
  };
}

export function createComponentNode(name: string): ResourceNode {
  return {
    kind: "component",
    type: "__component__",
    name,
    props: {},
    children: [],
    parent: null,
    meta: {},
  };
}

/**
 * Sentinel type token used for the invisible root container
 * that the reconciler needs as an entry point.
 */
export const ROOT_TYPE = "__react_pulumi_root__";

/**
 * Sentinel type token for <Group> host component.
 * Creates a Pulumi ComponentResource during materialization.
 */
export const GROUP_TYPE = "__react_pulumi_group__";

/**
 * Walk the tree and propagate provider scope downward.
 * When a provider node is encountered, its name is added to the providers map
 * for its package. Inner providers override outer for the same package.
 * Transparent component nodes pass providers through without modification.
 */
export function propagateProviders(root: ResourceNode): void {
  function walk(node: ResourceNode, inherited: Record<string, string>): void {
    // Provider nodes register themselves in the inherited map
    if (node.isProvider && node.providerPackage) {
      inherited = { ...inherited, [node.providerPackage]: node.name };
    }

    // Apply inherited providers to resource/group nodes (not components, not root)
    if (node.kind === "resource" && node.type !== ROOT_TYPE) {
      if (Object.keys(inherited).length > 0) {
        node.providers = { ...inherited };
      }
    } else if (node.kind === "group") {
      if (Object.keys(inherited).length > 0) {
        node.providers = { ...inherited };
      }
    }

    for (const child of node.children) {
      walk(child, inherited);
    }
  }

  walk(root, {});
}
