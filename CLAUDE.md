# react-pulumi

React reconciler for Pulumi infrastructure-as-code. Write cloud infrastructure as JSX components.

## Architecture

```
JSX Component → renderToResourceTree() → ResourceNode tree → materializeTree() → Pulumi resources → cloud
```

**Core flow**: React reconciler builds an in-memory `ResourceNode` tree from JSX. No DOM, no double-diffing — React builds the tree, Pulumi diffs against cloud state.

**With `renderToPulumi`** (standard `pulumi up` compatible):
```
Pulumi.<stack>.yaml → loadState → interceptor → render → materialize → dynamic resource → config set
```
`useState` values persist to `Pulumi.<stack>.yaml` via a dynamic resource that writes on deploy success.

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

Tests are excluded from `tsc` build (tsconfig `exclude: ["src/__tests__"]`) because host component type tokens (strings from `pulumiToComponent`) don't satisfy JSX `IntrinsicAttributes`. Vitest uses esbuild which doesn't enforce this.

## Key modules

### `packages/core/src/reconciler.ts`
Custom React reconciler host config (mutation mode). React 19 requires `resolveUpdatePriority`, `getCurrentUpdatePriority`, `setCurrentUpdatePriority`, `supportsMicrotasks`, and many other config keys not documented in older react-reconciler guides.

### `packages/core/src/renderer.ts`
Uses `updateContainerSync()` + `flushSyncWork()` (not the older `flushSync`) for synchronous rendering. React 19 reconciler only supports `ConcurrentRoot` (tag=1).

### `packages/core/src/wrap.ts`
`pulumiToComponent(ResourceClass, typeToken)` registers the class in a global registry and returns the type token string. The reconciler's `createInstance` uses this token to build `ResourceNode`s.

### `packages/core/src/pulumi-bridge.ts`
`materializeTree(root)` walks the ResourceNode tree and calls `new ResourceClass(name, props, { parent })` for each node. Root node (type `__react_pulumi_root__`) is skipped.

### `packages/core/src/render-to-pulumi.ts`
`renderToPulumi(Component)` returns a `() => void` function for use as a standard Pulumi program (default export). Orchestrates: read config → load state → install interceptor → render → collect hook keys → materialize → create state dynamic resource → reset. Compatible with `pulumi up` without the react-pulumi CLI.

### `packages/core/src/state-store.ts`
Module-level store for persisted `useState` values. `loadState()` hydrates from `Pulumi.<stack>.yaml`, `getNextValue()` returns hydrated or default values, `trackValue()` tracks setter calls, `collectState()` snapshots for persistence.

### `packages/core/src/state-interceptor.ts`
Proxy-based interceptor on React 19's `__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H` dispatcher. Wraps `useState` to hydrate from persisted state; all other hooks pass through. `installInterceptor()` returns a cleanup function.

### `packages/core/src/hooks/useConfig.ts`
`useConfig(key, defaultValue?)` reads Pulumi stack config during render. Supports namespaced keys (`"aws:region"` → `Config("aws").get("region")`). Config instances cached per namespace, reset between `renderToPulumi` calls.

### `packages/core/src/hooks/useStackOutput.ts`
`useStackOutput(stackName, outputKey)` reads an output from another Pulumi stack. Returns `pulumi.Output<T>` for passing directly into resource props. StackReference instances cached per stack name, reset between renders.

### `packages/cli/src/commands/up.ts`
Loads user TSX via dynamic import, renders to tree, materializes inside a Pulumi `LocalWorkspace.createOrSelectStack({ projectName, stackName, program })` using `InlineProgramArgs`.

## React prop caveats

- `key` and `ref` are reserved React props — they get stripped by React before reaching `createInstance`. Pulumi resources that have a `key` input (e.g., S3 BucketObject) need a different prop name (e.g., `objectKey`) and mapping in the bridge layer.
- `name` prop is used as the Pulumi resource's logical name. If omitted, the type token is used.
- `children` prop is stripped — child components become tree children via `appendChild`.

## Using `renderToPulumi` (standard Pulumi)

```tsx
import * as pulumi from "@pulumi/pulumi";
import { useState } from "react";
import { pulumiToComponent, renderToPulumi, setPulumiSDK } from "@react-pulumi/core";
import * as aws from "@pulumi/aws";

setPulumiSDK(pulumi);
const Instance = pulumiToComponent(aws.ec2.Instance);

function App() {
  const [replicas] = useState(2); // persisted to Pulumi.<stack>.yaml
  return Array.from({ length: replicas }, (_, i) => (
    <Instance key={i} name={`web-${i}`} instanceType="t3.micro" ami="ami-123" />
  ));
}

export default renderToPulumi(App);
// Then: pulumi up
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

const Bucket = pulumiToComponent(aws.s3.Bucket, "aws:s3:Bucket");
// Use in JSX: <Bucket name="my-bucket" versioning={true} />
```

## Viz store

Zustand store at `packages/viz/src/store.ts` tracks:
- `resourceTree` — full ResourceNode tree
- `deploymentStatus` — idle/previewing/deploying/destroying/complete/error
- `resourceStatuses` — per-resource URN status map

## Actions system

`<Action name="scale-up" handler={fn} />` registers in `actionRegistry`. Viz dashboard will surface these as buttons; REST API (`GET /actions`, `POST /actions/:name`) is planned.
