# Usage Guide

## Two Ways to Use react-pulumi

### 1. Standard Pulumi (`pulumi up`) — recommended

Use `renderToPulumi` for full compatibility with the standard Pulumi CLI. Supports `useState` persistence, `useConfig`, and `useStackOutput`.

```tsx
// index.tsx
import React, { useState } from "react";
import * as pulumi from "@pulumi/pulumi";
import { pulumiToComponent, renderToPulumi, setPulumiSDK, useConfig } from "@react-pulumi/core";
import * as aws from "@pulumi/aws";

setPulumiSDK(pulumi);
const [Instance] = pulumiToComponent(aws.ec2.Instance);

function App() {
  const [replicas] = useState(2);
  const region = useConfig("aws:region");
  // ...
}

renderToPulumi(App)();
```

```yaml
# Pulumi.yaml
name: my-project
runtime:
  name: nodejs
  options:
    typescript: false
    nodeargs: "--import tsx"
main: index.tsx
```

```bash
pulumi up
```

### 2. react-pulumi CLI

Simpler entry point — just export a component. The CLI handles SDK setup and deployment via `LocalWorkspace`.

```tsx
// index.tsx
import React from "react";
import { pulumiToComponent } from "@react-pulumi/core";
import * as aws from "@pulumi/aws";

const [Instance] = pulumiToComponent(aws.ec2.Instance);

export default function App() {
  return <Instance name="web-0" instanceType="t3.micro" />;
}
```

```bash
react-pulumi up ./index.tsx
react-pulumi preview ./index.tsx
react-pulumi destroy ./index.tsx
```

> The CLI does not support `useState` persistence, `useConfig`, or `useStackOutput`. Use `renderToPulumi` for those features.

---

## Reading Config with `useConfig`

`useConfig` reads values from `Pulumi.<stack>.yaml` config during render.

### Setting config values

```bash
pulumi config set replicas 4
pulumi config set aws:region us-west-2
pulumi config set myapp:env production
```

This produces:

```yaml
# Pulumi.dev.yaml
config:
  react-pulumi-my-project:replicas: "4"
  aws:region: us-west-2
  myapp:env: production
```

### Reading config in components

```tsx
import { useConfig } from "@react-pulumi/core";

function App() {
  // Bare key — reads from project namespace
  const replicas = Number(useConfig("replicas", "2"));

  // Namespaced key — reads from specific namespace
  const region = useConfig("aws:region");
  const env = useConfig("myapp:env", "dev");

  return Array.from({ length: replicas }, (_, i) => (
    <Instance key={i} name={`web-${region}-${i}`} tags={{ env }} />
  ));
}
```

### Config values are always strings

Pulumi config values are strings. Parse them yourself:

```tsx
const count = Number(useConfig("count", "1"));
const enabled = useConfig("enabled", "true") === "true";
const tags = JSON.parse(useConfig("tags", "{}") ?? "{}");
```

### Namespaced keys

The colon separates namespace from key:

| `useConfig(...)` | Config class | Key |
|------------------|-------------|-----|
| `"replicas"` | `new pulumi.Config()` (project) | `"replicas"` |
| `"aws:region"` | `new pulumi.Config("aws")` | `"region"` |
| `"myapp:env"` | `new pulumi.Config("myapp")` | `"env"` |

---

## Cross-Stack References with `useStackOutput`

`useStackOutput` reads outputs exported by another Pulumi stack. This is how you share values (VPC IDs, subnet IDs, etc.) between stacks.

### Exporting outputs from a stack

In the upstream stack (plain Pulumi or react-pulumi):

```tsx
// network stack
export const vpcId = vpc.id;
export const subnetIds = subnets.map(s => s.id);
```

### Reading outputs in another stack

```tsx
import { useStackOutput } from "@react-pulumi/core";

function App() {
  // "org/network/prod" = fully qualified stack name
  const vpcId = useStackOutput("org/network/prod", "vpcId");
  const subnetIds = useStackOutput("org/network/prod", "subnetIds");

  return (
    <SecurityGroup name="web-sg" vpcId={vpcId}>
      <Instance name="web-0" subnetId={subnetIds} />
    </SecurityGroup>
  );
}
```

### How it works

- `useStackOutput` creates a `pulumi.StackReference` and calls `.getOutput(key)`
- Returns a `pulumi.Output<T>` — an async value that resolves during `pulumi up`
- Pass Outputs directly into resource props; the Pulumi engine resolves them
- Multiple calls to the same stack reuse a single StackReference (cached)

### Stack name format

The stack name must be fully qualified: `"org/project/stack"` or `"project/stack"` depending on your Pulumi backend.

---

## Persistent State with `useState`

When using `renderToPulumi`, React's `useState` values automatically persist to `Pulumi.<stack>.yaml` between runs.

### How it works

1. On program start, `renderToPulumi` reads `react-pulumi:state` from config
2. During render, the `useState` interceptor returns persisted values instead of defaults
3. After deploy, a dynamic resource writes the current state back to config

### Example

```tsx
function App() {
  const [replicas] = useState(2);       // persisted
  const [region] = useState("us-east-1"); // persisted

  return Array.from({ length: replicas }, (_, i) => (
    <Instance key={i} name={`web-${region}-${i}`} />
  ));
}
```

First run: defaults used (replicas=2, region="us-east-1"). State saved:

```yaml
config:
  react-pulumi:state: '{"keys":["App:0","App:1"],"values":[2,"us-east-1"]}'
```

### Modifying state between runs

Edit the config directly:

```bash
pulumi config set react-pulumi:state '{"keys":["App:0","App:1"],"values":[5,"eu-west-1"]}'
pulumi up   # replicas=5, region=eu-west-1
```

### Structure change detection

If you add, remove, or reorder `useState` hooks, the key pattern changes. `renderToPulumi` detects this and logs a warning:

```
[react-pulumi] Component structure changed — hook keys no longer match.
Some state values may reset to defaults.
```

State keys use the format `ComponentName:localHookIndex` (e.g., `App:0`, `WebTier:1`).

---

## Provider Scoping

Override the default Pulumi provider for a cloud package by wrapping resources:

```tsx
const [AwsProvider] = pulumiToComponent(aws.Provider);

function App() {
  return (
    <>
      {/* us-west-2 provider for everything inside */}
      <AwsProvider name="west" region="us-west-2">
        <Bucket name="west-data" />

        {/* us-east-1 override for DR resources */}
        <AwsProvider name="east" region="us-east-1">
          <Bucket name="east-backup" />
        </AwsProvider>
      </AwsProvider>
    </>
  );
}
```

- Provider type tokens (`pulumi:providers:<pkg>`) are auto-detected
- Inner providers override outer for the same package
- Providers propagate through React component boundaries (transparent)
- Provider flows via `opts.provider` — the provider is NOT the Pulumi parent

### Explicit provider override

Use `opts.provider` to reference a provider by name:

```tsx
<AwsProvider name="east" region="us-east-1" />
<Bucket name="east-bucket" opts={{ provider: "east" }} />
```

---

## ComponentResource Groups

Use `<Group>` to create a Pulumi `ComponentResource` that logically groups child resources:

```tsx
import { Group } from "@react-pulumi/core";

function StaticSite({ name }: { name: string }) {
  return (
    <Group name={name} type="custom:component:StaticSite">
      <Bucket name={`${name}-bucket`} />
      <BucketObject name={`${name}-index`} objectKey="index.html" />
      <CloudFrontDistribution name={`${name}-cdn`} />
    </Group>
  );
}
```

Children of `<Group>` have the ComponentResource as their Pulumi parent. The group appears as a single collapsible node in `pulumi stack` output and the viz dashboard.

---

## Resource Options

Pass Pulumi resource options via the `opts` prop:

```tsx
<RdsInstance
  name="production-db"
  instanceClass="db.t3.large"
  opts={{
    protect: true,                        // prevent accidental deletion
    ignoreChanges: ["tags"],              // ignore tag drift
    dependsOn: ["migration-runner"],      // wait for migration
    customTimeouts: { create: "30m" },    // 30 minute create timeout
  }}
/>
```

### Explicit dependencies

Reference resources by name (resolved during materialization):

```tsx
<Bucket name="config-bucket" />
<Lambda
  name="processor"
  opts={{ dependsOn: ["config-bucket"] }}
/>
```

---

## Project Setup Reference

### `Pulumi.yaml`

```yaml
name: my-project
runtime:
  name: nodejs
  options:
    typescript: false      # we use tsx loader, not ts-node
    nodeargs: "--import tsx"
main: index.tsx
```

- `typescript: false` disables Pulumi's built-in ts-node (we use `tsx` instead)
- `nodeargs: "--import tsx"` registers the tsx ESM loader
- `main: index.tsx` points to the entry file

### `package.json`

```json
{
  "type": "module",
  "dependencies": {
    "@react-pulumi/core": "...",
    "@pulumi/pulumi": "^3.0.0",
    "react": "^19.0.0"
  },
  "devDependencies": {
    "tsx": "^4.0.0"
  }
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```
