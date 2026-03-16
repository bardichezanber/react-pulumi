import type { ResourceNode } from "./resource-tree.js";
import { getRegistry, type PulumiResourceConstructor } from "./registry.js";
import { ROOT_TYPE } from "./resource-tree.js";
import { extractResourcePackage } from "./wrap.js";

/**
 * Cached reference to Pulumi's ComponentResource class.
 * Lazily resolved on first use to avoid hard dependency on @pulumi/pulumi.
 */
let componentResourceClass: PulumiResourceConstructor | null | undefined;

/**
 * Cached reference to the full Pulumi SDK for renderToPulumi.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pulumiSDK: any | undefined;

function getComponentResourceClass(): PulumiResourceConstructor | null {
  if (componentResourceClass !== undefined) return componentResourceClass;
  componentResourceClass = null;
  return componentResourceClass;
}

/**
 * Register the Pulumi SDK so that `<Group>` can create ComponentResources
 * and `renderToPulumi` can access Config and dynamic resources.
 * Call this once before `materializeTree` or `renderToPulumi`.
 *
 * ```ts
 * import * as pulumi from "@pulumi/pulumi";
 * setPulumiSDK(pulumi);
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setPulumiSDK(pulumi: any): void {
  pulumiSDK = pulumi;
  if (pulumi.ComponentResource) {
    componentResourceClass = pulumi.ComponentResource;
  }
}

/**
 * Get the registered Pulumi SDK. Throws if not set.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPulumiSDK(): any {
  if (!pulumiSDK) {
    throw new Error(
      "[react-pulumi] Pulumi SDK not registered. " +
        "Call setPulumiSDK(pulumi) before using renderToPulumi.",
    );
  }
  return pulumiSDK;
}

/**
 * Walks the ResourceNode tree and instantiates real Pulumi resources.
 *
 * - Root nodes and transparent component nodes are skipped.
 * - Group nodes (kind: "group") create a `ComponentResource` and
 *   pass it as the Pulumi parent for all children.
 * - Provider nodes create the provider resource and register it by name
 *   but do NOT become the Pulumi parent of their children.
 * - Resource nodes create `new ResourceClass(name, props, { parent, ...opts })`.
 */
export function materializeTree(
  root: ResourceNode,
  registryOverride?: ReadonlyMap<string, PulumiResourceConstructor>,
): unknown[] {
  const registry = registryOverride ?? getRegistry();
  const resources: unknown[] = [];

  // Name → Pulumi instance maps for resolving string-based references
  const providerInstances = new Map<string, unknown>();
  const resourceInstances = new Map<string, unknown>();

  function resolveProvider(node: ResourceNode): unknown | undefined {
    // 1. Explicit opts.provider (name-based override)
    if (node.opts?.provider) {
      const inst = providerInstances.get(node.opts.provider as string);
      if (!inst) {
        throw new Error(
          `opts.provider "${node.opts.provider}" on resource "${node.name}" ` +
            `refers to an unknown provider. Make sure the provider is declared before this resource.`,
        );
      }
      return inst;
    }

    // 2. Inherited provider from context (propagateProviders)
    if (node.providers) {
      const pkg = extractResourcePackage(node.type);
      if (pkg && node.providers[pkg]) {
        return providerInstances.get(node.providers[pkg]);
      }
    }

    return undefined;
  }

  function resolveDependsOn(names: string[]): unknown[] {
    return names.map((name) => {
      const inst = resourceInstances.get(name) ?? providerInstances.get(name);
      if (!inst) {
        throw new Error(
          `opts.dependsOn references "${name}" which has not been materialized yet. ` +
            `Make sure the dependency is declared before the dependent resource.`,
        );
      }
      return inst;
    });
  }

  function buildOpts(node: ResourceNode, pulumiParent: unknown | undefined): Record<string, unknown> {
    const opts: Record<string, unknown> = {};
    if (pulumiParent) opts.parent = pulumiParent;

    // Resolve provider
    const provider = resolveProvider(node);
    if (provider) opts.provider = provider;

    // Merge explicit opts (except provider/dependsOn which need resolution)
    if (node.opts) {
      const { provider: _p, dependsOn, ...rest } = node.opts;
      Object.assign(opts, rest);

      // Resolve dependsOn name strings to instances
      if (dependsOn && Array.isArray(dependsOn)) {
        opts.dependsOn = resolveDependsOn(dependsOn as string[]);
      }
    }

    return opts;
  }

  function walk(node: ResourceNode, pulumiParent?: unknown): void {
    // Action nodes — not infrastructure, skip
    if (node.kind === "action") return;

    // Root and transparent component nodes — pass through
    if (node.type === ROOT_TYPE || node.kind === "component") {
      for (const child of node.children) {
        walk(child, pulumiParent);
      }
      return;
    }

    // Group nodes — create a Pulumi ComponentResource wrapper
    if (node.kind === "group") {
      const componentType = (node.meta.componentType as string) ?? node.name;
      const opts: Record<string, unknown> = {};
      if (pulumiParent) opts.parent = pulumiParent;

      const ComponentResourceCtor = getComponentResourceClass();
      let groupParent: unknown;

      if (ComponentResourceCtor) {
        // ComponentResource(type, name, args, opts) — pass args={} and opts with parent
        groupParent = new (ComponentResourceCtor as new (...args: unknown[]) => unknown)(
          componentType, node.name, {}, opts,
        );
        resources.push(groupParent);
        resourceInstances.set(node.name, groupParent);
      } else {
        // @pulumi/pulumi not available (e.g. viz-only mode) — treat as transparent
        groupParent = pulumiParent;
      }

      for (const child of node.children) {
        walk(child, groupParent);
      }

      // Signal that the ComponentResource is fully constructed
      if (groupParent && typeof (groupParent as Record<string, unknown>).registerOutputs === "function") {
        (groupParent as { registerOutputs: (o: Record<string, unknown>) => void }).registerOutputs({});
      }

      return;
    }

    // Regular resource nodes (including provider nodes)
    const Ctor = registry.get(node.type);
    if (!Ctor) {
      throw new Error(
        `No Pulumi resource class registered for type token "${node.type}". ` +
          `Did you forget to call pulumiToComponent()?`,
      );
    }

    if (node.isProvider) {
      // Provider nodes: create the resource but do NOT become the parent of children.
      // Children use the same pulumiParent as the provider itself.
      const opts = buildOpts(node, pulumiParent);
      const instance = new Ctor(node.name, { ...node.props }, opts);
      resources.push(instance);
      providerInstances.set(node.name, instance);
      resourceInstances.set(node.name, instance);

      // Provider's children inherit the same parent (provider flows via opts.provider, not parent)
      for (const child of node.children) {
        walk(child, pulumiParent);
      }
    } else {
      // Normal resource
      const opts = buildOpts(node, pulumiParent);
      const instance = new Ctor(node.name, { ...node.props }, opts);
      resources.push(instance);
      resourceInstances.set(node.name, instance);

      for (const child of node.children) {
        walk(child, instance);
      }
    }
  }

  walk(root);
  return resources;
}
