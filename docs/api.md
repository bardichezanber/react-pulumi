# API Reference

## Core Functions

### `pulumiToComponent(ResourceClass, typeToken?)`

Wraps a Pulumi resource class as a React host component.

```tsx
import { pulumiToComponent } from "@react-pulumi/core";
import * as aws from "@pulumi/aws";

// Auto-extract type token from __pulumiType static property
const Bucket = pulumiToComponent(aws.s3.Bucket);

// Or specify explicitly
const Instance = pulumiToComponent(aws.ec2.Instance, "aws:ec2:Instance");
```

**Parameters:**
- `ResourceClass` — Pulumi resource constructor (e.g., `aws.s3.Bucket`)
- `typeToken` *(optional)* — Pulumi type token string. Auto-extracted from `ResourceClass.__pulumiType` if omitted.

**Returns:** A string token that JSX treats as a host component. All resource args become JSX props.

**JSX Props:**
- All resource constructor args (second parameter) as `Partial<Args>`
- `name` — Pulumi logical name (defaults to type token)
- `opts` — Pulumi resource options (`protect`, `ignoreChanges`, `dependsOn`, etc.)
- `children` — nested resources become Pulumi children
- `key` — React key (stripped by React, not passed to Pulumi)

---

### `renderToPulumi(Component)`

Wraps a React component for use as a standard Pulumi program. Handles the full lifecycle: state hydration, rendering, materialization, and state persistence.

```tsx
import * as pulumi from "@pulumi/pulumi";
import { renderToPulumi, setPulumiSDK } from "@react-pulumi/core";

setPulumiSDK(pulumi);

function App() { /* ... */ }

renderToPulumi(App)();
```

**Parameters:**
- `Component` — React function component (`FC`)

**Returns:** `() => void` — call it at module top level to run the Pulumi program.

**Lifecycle:**
1. Read persisted state from `Pulumi.<stack>.yaml` (`react-pulumi:state` config key)
2. Install `useState` interceptor (hydrate from persisted values)
3. Render component tree synchronously
4. Validate hook keys against previous state (warn on structure change)
5. Materialize resource tree into real Pulumi resources
6. Create dynamic resource to write state back on deploy success
7. Reset all caches (state, config, stack refs)

**Requires:** `setPulumiSDK(pulumi)` must be called before `renderToPulumi(App)()`.

---

### `setPulumiSDK(pulumi)`

Register the Pulumi SDK for use by `renderToPulumi`, `useConfig`, `useStackOutput`, and `<Group>` materialization.

```tsx
import * as pulumi from "@pulumi/pulumi";
import { setPulumiSDK } from "@react-pulumi/core";

setPulumiSDK(pulumi);
```

**Parameters:**
- `pulumi` — the `@pulumi/pulumi` module (or any object with `Config`, `StackReference`, `ComponentResource`, `dynamic.Resource`)

Must be called once before using `renderToPulumi` or custom hooks.

---

### `renderToResourceTree(element, opts?)`

Low-level: renders a React element into a `ResourceNode` tree without materializing Pulumi resources. Used by `renderToPulumi` internally and by the CLI.

```tsx
import { createElement } from "react";
import { renderToResourceTree } from "@react-pulumi/core";

const tree = renderToResourceTree(createElement(App));
```

**Parameters:**
- `element` — React element
- `opts.returnFiberRoot` *(optional)* — if `true`, returns `{ tree, fiberRoot }` for hook key extraction

**Returns:** `ResourceNode` (or `RenderResult` if `returnFiberRoot: true`)

---

### `materializeTree(root, registryOverride?)`

Low-level: walks a `ResourceNode` tree and instantiates real Pulumi resources with parent-child relationships.

```tsx
import { materializeTree } from "@react-pulumi/core";

const resources = materializeTree(tree);
```

**Parameters:**
- `root` — `ResourceNode` tree (from `renderToResourceTree`)
- `registryOverride` *(optional)* — custom type token → constructor map

**Returns:** `unknown[]` — array of created Pulumi resource instances

---

## Hooks

### `useConfig(key, defaultValue?)`

Read a value from Pulumi stack config during render.

```tsx
import { useConfig } from "@react-pulumi/core";

function App() {
  const region = useConfig("aws:region");             // string | undefined
  const replicas = useConfig("replicas", "2");        // string (default "2")
  const env = useConfig("env", "dev");                // string (default "dev")
  // ...
}
```

**Parameters:**
- `key` — config key. Supports namespaced keys:
  - `"replicas"` → `new pulumi.Config()` (project namespace) → `.get("replicas")`
  - `"aws:region"` → `new pulumi.Config("aws")` → `.get("region")`
- `defaultValue` *(optional)* — returned when the key is not set

**Returns:** `string | undefined`

**Notes:**
- All config values are strings. Parse numbers/booleans yourself: `Number(useConfig("count", "2"))`
- Config instances are cached per namespace within a render
- Set config values via `pulumi config set <key> <value>`
- Requires `setPulumiSDK(pulumi)` to have been called

---

### `useStackOutput(stackName, outputKey)`

Read an output from another Pulumi stack. Returns a Pulumi `Output<T>` that resolves during `pulumi up`.

```tsx
import { useStackOutput } from "@react-pulumi/core";

function App() {
  const vpcId = useStackOutput("org/network/prod", "vpcId");
  const subnetIds = useStackOutput("org/network/prod", "subnetIds");

  return (
    <SecurityGroup name="web-sg" vpcId={vpcId}>
      <Instance name="web-0" subnetId={subnetIds} />
    </SecurityGroup>
  );
}
```

**Parameters:**
- `stackName` — fully qualified stack name (e.g., `"org/project/stack"`)
- `outputKey` — output key name exported by the referenced stack

**Returns:** `pulumi.Output<T>` — pass directly into resource props. The Pulumi engine resolves the value during deployment.

**Notes:**
- StackReference instances are cached per stack name (multiple calls to the same stack reuse one reference)
- The referenced stack must exist and have the specified output
- Requires `setPulumiSDK(pulumi)` to have been called

---

## Components

### `<Group>`

Creates a Pulumi `ComponentResource` wrapper. Groups child resources under a single logical component in the Pulumi state.

```tsx
import { Group } from "@react-pulumi/core";

function App() {
  return (
    <Group name="my-site" type="custom:component:StaticSite">
      <Bucket name="site-bucket" />
      <BucketObject name="site-index" />
    </Group>
  );
}
```

**Props:**
- `name` — logical name for the ComponentResource
- `type` — Pulumi type token (e.g., `"custom:component:StaticSite"`)
- `children` — nested resources

Requires `setPulumiSDK(pulumi)` for the `ComponentResource` constructor.

---

### `<Action>`

Register a named action for the viz dashboard. Actions are metadata-only during one-shot mode; they become live triggers in serve mode.

```tsx
import { Action } from "@react-pulumi/core";

function App() {
  return (
    <>
      <Instance name="web-0" />
      <Action name="scale-up" handler={() => { /* ... */ }} description="Add a replica" />
    </>
  );
}
```

**Props:**
- `name` — action identifier
- `handler` — callback function (executed in serve mode)
- `description` *(optional)* — human-readable description for viz dashboard

---

## Resource Options (`opts` prop)

Any wrapped Pulumi resource accepts an `opts` prop for Pulumi resource options:

```tsx
<Bucket
  name="protected-bucket"
  opts={{
    protect: true,
    ignoreChanges: ["tags"],
    dependsOn: ["config-bucket"],
    provider: "us-west",
  }}
/>
```

**Supported options:**
| Option | Type | Description |
|--------|------|-------------|
| `protect` | `boolean` | Prevent accidental deletion |
| `ignoreChanges` | `string[]` | Properties to ignore during diff |
| `replaceOnChanges` | `string[]` | Properties that force replacement |
| `deleteBeforeReplace` | `boolean` | Delete before creating replacement |
| `retainOnDelete` | `boolean` | Keep resource when removed from code |
| `aliases` | `string[]` | Alternative URNs for state migration |
| `provider` | `string` | Provider name (resolved during materialization) |
| `dependsOn` | `string[]` | Explicit dependencies by resource name |
| `customTimeouts` | `object` | `{ create?, update?, delete? }` timeout strings |

---

## Provider Scoping

Wrap resources in a provider component to override the default provider for a package:

```tsx
const AwsProvider = pulumiToComponent(aws.Provider);

function App() {
  return (
    <AwsProvider name="us-west" region="us-west-2">
      <Bucket name="west-bucket" />

      <AwsProvider name="us-east" region="us-east-1">
        <Bucket name="east-bucket" />
      </AwsProvider>
    </AwsProvider>
  );
}
```

- Provider type tokens matching `pulumi:providers:<pkg>` are auto-detected
- Inner providers override outer for the same package
- Provider flows via `opts.provider`, not parent-child relationship
- Propagates through transparent React component boundaries

---

## Types

### `ResourceNode`

```typescript
interface ResourceNode {
  kind: "resource" | "component" | "group" | "action";
  type: string;           // Pulumi type token
  name: string;           // logical name
  props: Record<string, unknown>;
  children: ResourceNode[];
  parent: ResourceNode | null;
  providers?: Record<string, string>;
  opts?: Record<string, unknown>;
  isProvider?: boolean;
  providerPackage?: string;
  meta: ResourceMeta;
}
```

### `PersistedState`

```typescript
interface PersistedState {
  keys: string[];      // ["App:0", "App:1"] — ComponentName:hookIndex
  values: unknown[];   // [3, 16] — corresponding values
}
```

### `ResourceOpts`

```typescript
interface ResourceOpts {
  protect?: boolean;
  ignoreChanges?: string[];
  replaceOnChanges?: string[];
  deleteBeforeReplace?: boolean;
  retainOnDelete?: boolean;
  aliases?: string[];
  provider?: string;
  dependsOn?: string[];
  customTimeouts?: { create?: string; update?: string; delete?: string };
}
```
