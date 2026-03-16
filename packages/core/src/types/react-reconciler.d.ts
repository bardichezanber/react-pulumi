declare module "react-reconciler" {
  import type { ReactElement } from "react";

  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Reconciler {
    // Minimal HostConfig — methods are loosely typed to avoid fighting
    // the reconciler's internal overload surface.
    type HostConfig<
      Type,
      Props,
      Container,
      Instance,
      TextInstance,
      SuspenseInstance,
      HydratableInstance,
      PublicInstance,
      HostContext,
      UpdatePayload,
      ChildSet,
      TimeoutHandle,
      NoTimeout,
    > = Record<string, unknown>;
  }

  export interface ReconcilerInstance<Container> {
    createContainer(
      containerInfo: Container,
      tag: number,
      hydrationCallbacks: unknown,
      isStrictMode: boolean,
      identifierPrefix: string,
      onUncaughtError: (error: unknown) => void,
      onCaughtError: (error: unknown) => void,
      onRecoverableError: (error: unknown) => void,
      transitionCallbacks: unknown,
    ): unknown;

    updateContainer(
      element: ReactElement | null,
      container: unknown,
      parentComponent: unknown,
      callback?: () => void,
    ): void;

    flushSync(fn?: () => void): void;
  }

  function Reconciler<
    Type,
    Props,
    Container,
    Instance,
    TextInstance,
    SuspenseInstance,
    HydratableInstance,
    PublicInstance,
    HostContext,
    UpdatePayload,
    ChildSet,
    TimeoutHandle,
    NoTimeout,
  >(
    config: Reconciler.HostConfig<
      Type,
      Props,
      Container,
      Instance,
      TextInstance,
      SuspenseInstance,
      HydratableInstance,
      PublicInstance,
      HostContext,
      UpdatePayload,
      ChildSet,
      TimeoutHandle,
      NoTimeout
    >,
  ): ReconcilerInstance<Container>;

  export = Reconciler;
}

declare module "react-reconciler/constants.js" {
  export const DefaultEventPriority: number;
}
