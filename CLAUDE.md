# react-pulumi

React reconciler for Pulumi infrastructure-as-code. Write cloud infrastructure as JSX components.

## Architecture

```
JSX Component → renderToResourceTree() → React fiber tree → Pulumi resources (created at render time) → cloud
```

**Core flow**: `pulumiToComponent` returns `[Component, Context]`. The Component is a React FC that creates the Pulumi resource at render time and provides the instance via Context. Descendants read the instance via `useContext`.

**With `renderToPulumi`** (standard `pulumi up` compatible):
```
Pulumi.<stack>.yaml → loadState → interceptor → render (resources created as side effects) → dynamic resource → config set
```
`useState` values persist to `Pulumi.<stack>.yaml` via a dynamic resource that writes on deploy success.

**Legacy host-component path** (CLI backward compat):
```
registerResource() + string type tokens → reconciler createInstance → ResourceNode tree → materializeTree() → Pulumi resources
```

## Monorepo layout

```
packages/
  core/    # React reconciler, resource tree, Pulumi bridge, registry
  cli/     # react-pulumi CLI (up/preview/destroy/viz)
  viz/     # Web dashboard with React Flow graph + Zustand store
```

- pnpm workspaces + turborepo
- TypeScript strict mode, ES2022 target, ESM throughout
- React 19 + react-reconciler 0.31

## Build & test

```bash
pnpm install
pnpm -r build          # builds all packages (turbo)
pnpm --filter @react-pulumi/core test   # vitest
```

Tests are excluded from `tsc` build (tsconfig `exclude: ["src/__tests__"]`). Vitest uses esbuild which doesn't enforce strict JSX type checking.

## Key modules

### `packages/core/src/wrap.ts`
`pulumiToComponent(ResourceClass, typeToken?)` returns `[FC, Context]`:
- FC: React function component that calls `new ResourceClass(name, args, opts)` at render time and wraps children in a Context Provider
- Context: `React.Context<InstanceType<T>>` for descendants to read the instance
- Supports two children modes: Context mode (`<Vcn><SubnetLayer /></Vcn>`) and render props (`<Vcn>{(vcn) => ...}</Vcn>`)
- Still registers in the global registry for CLI backward compat + viz

### `packages/core/src/reconciler.ts`
Custom React reconciler host config (mutation mode). React 19 requires `resolveUpdatePriority`, `getCurrentUpdatePriority`, `setCurrentUpdatePriority`, `supportsMicrotasks`, and many other config keys not documented in older react-reconciler guides. Still supports host component mode (string type tokens) for backward compat.

### `packages/core/src/renderer.ts`
Uses `updateContainerSync()` + `flushSyncWork()` (not the older `flushSync`) for synchronous rendering. React 19 reconciler only supports `ConcurrentRoot` (tag=1). With the new FC-based `pulumiToComponent`, resources are created during this render phase.

### `packages/core/src/pulumi-bridge.ts`
`materializeTree(root)` walks the ResourceNode tree and calls `new ResourceClass(name, props, { parent })` for each node. This is the **legacy path** used by the CLI's host-component mode. Not needed when using the new `[Component, Context]` API (resources are created at render time).

### `packages/core/src/render-to-pulumi.ts`
`renderToPulumi(Component)` returns a `() => void` function for use as a standard Pulumi program (default export). Orchestrates: read config → load state → install interceptor → render (resources created as side effects) → collect hook keys → create state dynamic resource → reset. No longer calls `materializeTree`.

### `packages/core/src/state-store.ts`
Module-level store for persisted `useState` values. `loadState()` hydrates from `Pulumi.<stack>.yaml`, `getNextValue()` returns hydrated or default values, `trackValue()` tracks setter calls, `collectState()` snapshots for persistence.

### `packages/core/src/state-interceptor.ts`
Proxy-based interceptor on React 19's `__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H` dispatcher. Wraps `useState` to hydrate from persisted state and dispatch `HydrateEvent`/`SetterCallEvent` to a middleware pipeline. `installInterceptor({ middlewares })` accepts a `StateMiddleware[]` array and returns a cleanup function. Fixes the stale closure bug where functional setter updates used render-time value instead of current value.

### `packages/core/src/state-middleware.ts`
Event types (`HydrateEvent`, `SetterCallEvent`, `DeployOutcomeEvent` discriminated union), `StateMiddleware` interface, and error-resilient dispatch functions. Module-level sequence counter and deployId reset per `renderToPulumi` call.

### `packages/core/src/middlewares/`
- `persistence-middleware.ts`: Bridges middleware pipeline to `state-store.ts` `trackValue()`. Only acts on `setter_call` events.
- `action-log-middleware.ts`: Records events in memory, flushes to `.react-pulumi/action-log.json` on deploy outcome. Supports loading history from disk for cross-deploy event accumulation. Exported via `@react-pulumi/core/middlewares` subpath (Node.js only, not browser-safe).

### `packages/core/src/hooks/useConfig.ts`
`useConfig(key, defaultValue?)` reads Pulumi stack config during render. Supports namespaced keys (`"aws:region"` → `Config("aws").get("region")`). Config instances cached per namespace, reset between `renderToPulumi` calls.

### `packages/core/src/hooks/useStackOutput.ts`
`useStackOutput(stackName, outputKey)` reads an output from another Pulumi stack. Returns `pulumi.Output<T>` for passing directly into resource props. StackReference instances cached per stack name, reset between renders.

### `packages/cli/src/commands/up.ts`
Loads user TSX via dynamic import, renders via `renderToResourceTree` (which triggers resource creation) inside a Pulumi `LocalWorkspace.createOrSelectStack({ projectName, stackName, program })`.

## React prop caveats

- `key` and `ref` are reserved React props — they get stripped by React before reaching the component. Pulumi resources that have a `key` input (e.g., S3 BucketObject) need a different prop name (e.g., `objectKey`).
- `name` prop is used as the Pulumi resource's logical name. If omitted, the type token is used.
- `children` supports two modes: ReactNode (Context mode) or `(instance) => ReactNode` (render props mode).

## Using `pulumiToComponent`

```tsx
import * as pulumi from "@pulumi/pulumi";
import { useState, useContext } from "react";
import { pulumiToComponent, renderToPulumi, setPulumiSDK } from "@react-pulumi/core";
import * as oci from "@pulumi/oci";

setPulumiSDK(pulumi);
const [Vcn, VcnCtx] = pulumiToComponent(oci.core.Vcn);
const [Subnet] = pulumiToComponent(oci.core.Subnet);
const [Instance] = pulumiToComponent(oci.core.Instance);

function SubnetLayer() {
  const vcn = useContext(VcnCtx);
  return <Subnet name="pub" vcnId={vcn.id} cidrBlock="10.0.0.0/20" />;
}

function App() {
  const [replicas] = useState(2);
  return (
    <Vcn name="main" cidrBlock="10.0.0.0/16">
      <SubnetLayer />
    </Vcn>
  );
}

export default renderToPulumi(App);
// Then: pulumi up
```

**Render props mode** (inline wiring without separate components):
```tsx
<Vcn name="main" cidrBlock="10.0.0.0/16">
  {(vcn) => (
    <Subnet name="pub" vcnId={vcn.id} cidrBlock="10.0.0.0/20">
      {(subnet) => <Instance name="web-0" subnetId={subnet.id} />}
    </Subnet>
  )}
</Vcn>
```

**State persistence format** in `Pulumi.<stack>.yaml`:
```yaml
config:
  react-pulumi:state: '{"keys":["App:0"],"values":[2]}'
```

- Keys: `ComponentName:localHookIndex` — detects structural changes
- A dynamic resource (`__react_pulumi_state`) writes config on deploy success
- Preview mode: dynamic resource doesn't execute → config unchanged
- Failed deploys: config unchanged → state rolls back naturally

## Adding new resource types

```tsx
import { pulumiToComponent } from "@react-pulumi/core";
import * as aws from "@pulumi/aws";

const [Bucket, BucketCtx] = pulumiToComponent(aws.s3.Bucket);
// Context mode: <Bucket name="my-bucket"><ChildThatReadsCtx /></Bucket>
// Render props: <Bucket name="my-bucket">{(b) => <Other bucketId={b.id} />}</Bucket>
// Leaf (no Context needed): const [Lambda] = pulumiToComponent(aws.lambda.Function);
```

## Viz dashboard

### `packages/viz/src/infra-store.ts`
Zustand store with `devtools` middleware (sends state to Redux DevTools). Tracks: `resourceTree`, `deploymentStatus`, `resourceStatuses`, `timeline` (ActionLogEntry[]), `deployHistory`, `vizControls`, `wsConnected`, `wsReplayDone`. Replaces the old `store.ts`.

### `packages/viz/src/ws-server.ts`
WebSocket server (path `/ws`) using `ws` library. Attaches to the HTTP server via upgrade. On new client connect, replays buffered events from `BroadcastMiddleware.getReplayBuffer()`, then sends `replay_complete` sentinel.

### `packages/viz/src/server.ts`
HTTP + WebSocket server. REST API: `GET /api/tree`, `GET /api/history`, `GET /api/viz-controls`, `POST /api/deploy`, `POST /api/preview`, `POST /api/rollback`, `POST /api/viz-controls/:name`. Busy lock for deploy/preview/rollback (409 Conflict). All handler callbacks are set by the CLI layer:
- `onRerender` — lightweight re-render after viz control change (updates tree + controls)
- `onPreview` — real `pulumi preview` via Automation API, returns per-resource change summary
- `onDeploy` — real `pulumi up` via Automation API, returns per-resource change summary
- `onInvoke` — invoke a viz control in the CLI module context
- `onRollback` — set config + deploy
**Server never imports `vizRegistry` directly** — all control reads/invocations are delegated to the CLI module context via callbacks to avoid tsx + pnpm dual-module issues. Initial controls are passed via `initialControls` option; `lastKnownControls` is updated from `onRerender` results.

### `packages/viz/src/ws-client.ts`
Browser-side `useWebSocket` hook. Auto-reconnects on close (2s interval). Dispatches events to `useInfraStore`.

### Client components
- `ControlPanel.tsx` — Deploy/Preview buttons + WS connection status. Deploy flow: preview first → PreviewDialog → confirm → deploy → show results.
- `PreviewDialog.tsx` — Modal overlay showing per-resource preview/deploy results. Modes: `preview` (read-only), `deploy-confirm` (with Confirm Deploy button), `deploying` (spinner), `deploy-result` (success).
- `Timeline.tsx` — action/state history with state diffs
- `VizControls.tsx` — renders VizInput/VizButton controls from `vizRegistry`

## Actions and Viz controls

`<Action name="scale-up" handler={fn} />` registers in `actionRegistry`. `<VizInput>` and `<VizButton>` register in `vizRegistry` — these render as controllable UI in the viz dashboard. `vizRegistry` is analogous to `actionRegistry` (module-level Map). `vizRegistry.lock()`/`unlock()` prevents React 19's ConcurrentRoot deferred re-renders from overwriting correct intercepted setters with stale-indexed ones (used by `viz.ts` after each synchronous render).

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, node taxonomy, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.
