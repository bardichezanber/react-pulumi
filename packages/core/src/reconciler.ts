import Reconciler from "react-reconciler";
import { DefaultEventPriority } from "react-reconciler/constants.js";
import { createResourceNode, GROUP_TYPE, type ResourceNode } from "./resource-tree.js";
import { extractProviderPackage } from "./wrap.js";

// ---------- types the host config expects ----------
type Type = string; // Pulumi type token registered via wrap.ts
type Props = Record<string, unknown>;
type Container = ResourceNode; // root node
type Instance = ResourceNode;
type TextInstance = never;
type ChildSet = never;
type PublicInstance = ResourceNode;
type HostContext = Record<string, never>;
type UpdatePayload = Props;
type SuspenseInstance = never;
type TimeoutHandle = ReturnType<typeof setTimeout>;
type NoTimeout = -1;

const hostConfig = {
  // ---------- core ----------
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,

  isPrimaryRenderer: true,
  noTimeout: -1 as NoTimeout,

  createInstance(type: Type, props: Props, _root: Container, _hostContext: HostContext): Instance {
    const { children: _c, key: _k, ref: _r, opts, ...restProps } = props;
    const name = (restProps.name as string) ?? type;
    const node = createResourceNode(type, name, restProps);

    // <Group type="custom:MyComponent" name="..."> creates a ComponentResource wrapper
    if (type === GROUP_TYPE) {
      node.kind = "group";
      node.meta.componentType = restProps.type as string;
    }

    // Detect provider resources (type token like "pulumi:providers:aws")
    const providerPkg = extractProviderPackage(type);
    if (providerPkg) {
      node.isProvider = true;
      node.providerPackage = providerPkg;
    }

    // Store explicit resource options from JSX opts prop
    if (opts && typeof opts === "object") {
      node.opts = opts as Record<string, unknown>;
    }

    return node;
  },

  createTextInstance(): TextInstance {
    throw new Error(
      "react-pulumi does not support text nodes. " + "Only infrastructure components are allowed.",
    );
  },

  appendInitialChild(parent: Instance, child: Instance): void {
    child.parent = parent;
    parent.children.push(child);
  },

  appendChild(parent: Instance, child: Instance): void {
    child.parent = parent;
    parent.children.push(child);
  },

  appendChildToContainer(container: Container, child: Instance): void {
    child.parent = container;
    container.children.push(child);
  },

  removeChild(parent: Instance, child: Instance): void {
    const idx = parent.children.indexOf(child);
    if (idx !== -1) parent.children.splice(idx, 1);
    child.parent = null;
  },

  removeChildFromContainer(container: Container, child: Instance): void {
    const idx = container.children.indexOf(child);
    if (idx !== -1) container.children.splice(idx, 1);
    child.parent = null;
  },

  insertBefore(parent: Instance, child: Instance, before: Instance): void {
    child.parent = parent;
    const idx = parent.children.indexOf(before);
    if (idx !== -1) parent.children.splice(idx, 0, child);
    else parent.children.push(child);
  },

  insertInContainerBefore(container: Container, child: Instance, before: Instance): void {
    child.parent = container;
    const idx = container.children.indexOf(before);
    if (idx !== -1) container.children.splice(idx, 0, child);
    else container.children.push(child);
  },

  // ---------- updates ----------
  prepareUpdate(
    _instance: Instance,
    _type: Type,
    oldProps: Props,
    newProps: Props,
  ): UpdatePayload | null {
    const { children: _oc, key: _ok, ref: _or, ...oldRest } = oldProps;
    const { children: _nc, key: _nk, ref: _nr, ...newRest } = newProps;
    // Simple shallow diff — if anything changed, return new props
    for (const key of new Set([...Object.keys(oldRest), ...Object.keys(newRest)])) {
      if (oldRest[key] !== newRest[key]) return newRest;
    }
    return null;
  },

  commitUpdate(instance: Instance, updatePayload: UpdatePayload): void {
    instance.props = updatePayload;
  },

  // ---------- host context ----------
  getRootHostContext(): HostContext {
    return {};
  },

  getChildHostContext(parentContext: HostContext, _type: Type, _root: Container): HostContext {
    return parentContext;
  },

  // ---------- misc required methods ----------
  finalizeInitialChildren(): boolean {
    return false;
  },

  prepareForCommit(): Record<string, unknown> | null {
    return null;
  },

  resetAfterCommit(): void {},

  shouldSetTextContent(): boolean {
    return false;
  },

  getPublicInstance(instance: Instance): PublicInstance {
    return instance;
  },

  preparePortalMount(): void {},

  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,

  getCurrentEventPriority(): number {
    return DefaultEventPriority;
  },

  getInstanceFromNode(): null {
    return null;
  },

  prepareScopeUpdate(): void {},

  getInstanceFromScope(): null {
    return null;
  },

  detachDeletedInstance(): void {},

  beforeActiveInstanceBlur(): void {},
  afterActiveInstanceBlur(): void {},

  clearContainer(container: Container): void {
    container.children = [];
  },

  // React 19 reconciler requires these priority methods
  resolveUpdatePriority(): number {
    return DefaultEventPriority;
  },

  getCurrentUpdatePriority(): number {
    return DefaultEventPriority;
  },

  setCurrentUpdatePriority(): void {},

  // Microtask support
  supportsMicrotasks: true,
  scheduleMicrotask: typeof queueMicrotask === "function" ? queueMicrotask : setTimeout,

  // Resource/singleton/hoistable support flags
  supportsResources: false,
  supportsSingletons: false,
  supportsTestSelectors: false,

  // Required stubs for React 19
  resolveEventType(): null {
    return null;
  },
  resolveEventTimeStamp(): number {
    return Date.now();
  },
  shouldAttemptEagerTransition(): boolean {
    return false;
  },
  requestPostPaintCallback(): void {},
  maySuspendCommit(): boolean {
    return false;
  },
  preloadInstance(): boolean {
    return true;
  },
  startSuspendingCommit(): void {},
  suspendInstance(): void {},
  waitForCommitToBeReady(): null {
    return null;
  },
  NotPendingTransition: null as unknown,

  resetFormInstance(): void {},
  bindToConsole(): null {
    return null;
  },

  warnsIfNotActing: false,
  rendererPackageName: "react-pulumi",
  rendererVersion: "0.1.0",
};

export const reconciler = Reconciler<
  Type,
  Props,
  Container,
  Instance,
  TextInstance,
  SuspenseInstance,
  never,
  PublicInstance,
  HostContext,
  UpdatePayload,
  ChildSet,
  TimeoutHandle,
  NoTimeout
>(hostConfig as never);
