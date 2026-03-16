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
Proxy-based interceptor on React 19's `__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H` dispatcher. Wraps `useState` to hydrate from persisted state; all other hooks pass through. `installInterceptor()` returns a cleanup function.

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

## Viz store

Zustand store at `packages/viz/src/store.ts` tracks:
- `resourceTree` — full ResourceNode tree
- `deploymentStatus` — idle/previewing/deploying/destroying/complete/error
- `resourceStatuses` — per-resource URN status map

## Actions system

`<Action name="scale-up" handler={fn} />` registers in `actionRegistry`. Viz dashboard will surface these as buttons; REST API (`GET /actions`, `POST /actions/:name`) is planned.
