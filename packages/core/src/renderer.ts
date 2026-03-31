import type { ReactElement } from "react";
import { reconciler } from "./reconciler.js";
import {
  createComponentNode,
  createResourceNode,
  propagateProviders,
  type ResourceNode,
  ROOT_TYPE,
} from "./resource-tree.js";

type ReconcilerExt = typeof reconciler & {
  updateContainerSync(
    element: ReactElement | null,
    container: unknown,
    parentComponent: unknown,
  ): void;
  flushSyncWork(): void;
};

// React fiber tags we care about
const FunctionComponent = 0;
const HostComponent = 5;
const ForwardRef = 11;
const SimpleMemoComponent = 15;

interface Fiber {
  tag: number;
  type: { displayName?: string; name?: string } | string | null;
  stateNode: unknown;
  child: Fiber | null;
  sibling: Fiber | null;
}

interface FiberRoot {
  current: Fiber;
}

/**
 * Walk the React fiber tree and build a ResourceNode tree that includes
 * both Pulumi host-component nodes AND React function-component boundaries.
 */
function buildTreeFromFiber(fiberRoot: FiberRoot): ResourceNode {
  const root = createResourceNode(ROOT_TYPE, "root", {});

  function walk(fiber: Fiber | null, parent: ResourceNode): void {
    if (!fiber) return;

    let target = parent;

    if (
      fiber.tag === FunctionComponent ||
      fiber.tag === ForwardRef ||
      fiber.tag === SimpleMemoComponent
    ) {
      const fnType = fiber.type as { displayName?: string; name?: string } | null;
      const name = fnType?.displayName ?? fnType?.name;
      if (name) {
        const compNode = createComponentNode(name);
        // Store the resource logical name from JSX props for status mapping
        const fiberProps = (fiber as unknown as { memoizedProps?: Record<string, unknown> })
          .memoizedProps;
        if (fiberProps?.name) {
          compNode.meta.resourceName = fiberProps.name as string;
        }
        compNode.parent = parent;
        parent.children.push(compNode);
        target = compNode;
      }
    } else if (fiber.tag === HostComponent) {
      // fiber.stateNode is the ResourceNode created by the reconciler's createInstance
      const resourceNode = fiber.stateNode as ResourceNode;
      // Detach from the reconciler-built tree and re-parent under the enriched tree
      resourceNode.children = [];
      resourceNode.parent = parent;
      parent.children.push(resourceNode);
      target = resourceNode;
    }

    // Recurse into children, then siblings
    walk(fiber.child, target);
    walk(fiber.sibling, parent);
  }

  // fiberRoot.current is the HostRoot fiber; start from its first child
  walk(fiberRoot.current.child, root);
  return root;
}

/**
 * Extended Fiber type with memoizedState for hook walking.
 */
interface FiberWithHooks extends Fiber {
  memoizedState: HookNode | null;
  memoizedProps?: Record<string, unknown>;
}

interface HookNode {
  memoizedState: unknown;
  queue: unknown;
  next: HookNode | null;
}

/**
 * Result of renderToResourceTree, including the fiber root
 * for optional hook key extraction.
 */
export interface RenderResult {
  tree: ResourceNode;
  fiberRoot: FiberRoot;
}

/**
 * Synchronously renders a React element tree into a ResourceNode tree.
 * This is the primary entry point for converting JSX → infra resource graph.
 *
 * The returned tree includes both Pulumi resource nodes (kind: "resource")
 * and React component group nodes (kind: "component") so that the viz
 * dashboard can display the full component hierarchy.
 */
export function renderToResourceTree(element: ReactElement): ResourceNode;
export function renderToResourceTree(
  element: ReactElement,
  opts: { returnFiberRoot: true },
): RenderResult;
export function renderToResourceTree(
  element: ReactElement,
  opts?: { returnFiberRoot?: boolean },
): ResourceNode | RenderResult {
  const root = createResourceNode(ROOT_TYPE, "root", {});

  const container = reconciler.createContainer(
    root,
    1, // ConcurrentRoot (React 19 only supports this)
    null, // hydrationCallbacks
    false, // isStrictMode
    "", // identifierPrefix
    () => {}, // onUncaughtError
    () => {}, // onCaughtError
    () => {}, // onRecoverableError
    null, // transitionCallbacks
  );

  const r = reconciler as unknown as ReconcilerExt;
  r.updateContainerSync(element, container, null);
  r.flushSyncWork();

  const fiberRoot = container as unknown as FiberRoot;

  // Rebuild tree from fiber to capture React component boundaries
  const tree = buildTreeFromFiber(fiberRoot);

  // Propagate provider scope downward through the tree
  propagateProviders(tree);

  if (opts?.returnFiberRoot) {
    return { tree, fiberRoot };
  }
  return tree;
}

/**
 * Walk the fiber tree and collect keys for all useState hooks.
 * Key format: "ComponentName:localHookIndex"
 *
 * Only hooks with `queue !== null` are considered useState/useReducer hooks.
 * This matches React's internal representation where useState hooks
 * have a dispatch queue, while useEffect/useMemo/etc. do not.
 */
export function collectHookKeys(fiberRoot: FiberRoot): string[] {
  const keys: string[] = [];

  function walkFiber(fiber: Fiber | null): void {
    if (!fiber) return;

    if (
      fiber.tag === FunctionComponent ||
      fiber.tag === ForwardRef ||
      fiber.tag === SimpleMemoComponent
    ) {
      const fnType = fiber.type as { displayName?: string; name?: string } | null;
      const componentName = fnType?.displayName ?? fnType?.name ?? "Anonymous";
      const fiberWithHooks = fiber as unknown as FiberWithHooks;

      let hook = fiberWithHooks.memoizedState;
      let localIndex = 0;

      while (hook) {
        if (hook.queue !== null) {
          keys.push(`${componentName}:${localIndex}`);
          localIndex++;
        }
        hook = hook.next;
      }
    }

    walkFiber(fiber.child);
    walkFiber(fiber.sibling);
  }

  walkFiber(fiberRoot.current.child);
  return keys;
}
