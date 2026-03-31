# react-pulumi

> **Work in progress** — API is unstable and will change. Not ready for production use.

Write cloud infrastructure as React components. Deploy with Pulumi.

```tsx
import React, { useState } from "react";
import * as pulumi from "@pulumi/pulumi";
import { pulumiToComponent, renderToPulumi, setPulumiSDK } from "@react-pulumi/core";
import * as aws from "@pulumi/aws";

setPulumiSDK(pulumi);

const [Instance] = pulumiToComponent(aws.ec2.Instance);

function App() {
  const [replicas] = useState(2);
  return Array.from({ length: replicas }, (_, i) => (
    <Instance key={i} name={`web-${i}`} instanceType="t3.micro" ami="ami-0abcdef1234567890" />
  ));
}

renderToPulumi(App)();
```

```bash
pulumi up   # standard Pulumi CLI — useState persists to Pulumi.<stack>.yaml
```

## Why this project

IaC tools — Terraform, Pulumi, CloudFormation — all follow the same paradigm: **declare the desired state, let the engine compute the diff, apply it.** This works well for describing *what* the infrastructure should look like, but it says nothing about *how* to get there.

What's missing is **state transition management** — the ability to programmatically describe, inspect, and control the *changes* between infrastructure states. Questions like:

- What states has my infrastructure been through?
- Can I go back to a previous state and redeploy?
- If I change this variable, what resources are affected before I deploy?
- Can I visualize the state change history and diff between any two points?

React's entire purpose is managing state transitions — `useState`, `useReducer`, component lifecycle, and a mature ecosystem of state tools (Redux DevTools time travel, Zustand devtools, etc.). By building a React reconciler for Pulumi, we get:

1. **Composition** — infrastructure as composable components, not monolithic templates
2. **State management** — `useState` persists across deployments, enabling stateful infrastructure that remembers its configuration history
3. **State visualization** — the viz dashboard shows the resource graph, state timeline, and pending changes in real time
4. **Time machine** — every state mutation is logged; you can preview any historical state and roll back to it
5. **Ecosystem leverage** — Zustand devtools middleware feeds infrastructure state into Redux DevTools. The same time travel, state inspection, and replay tools that frontend developers use for UI state now work for cloud infrastructure

This isn't "JSX syntax sugar for IaC." It's bringing React's state management paradigm — and its entire ecosystem — to infrastructure.

## How it works

1. **`pulumiToComponent`** wraps Pulumi resource classes as React FCs that return `[Component, Context]`
2. **React reconciler** renders your JSX — resources are created at render time as side effects
3. **Context** provides resource instances to descendants — `useContext(VcnCtx)` reads the nearest ancestor
4. **Pulumi engine** diffs against cloud state and applies changes
5. **State persistence** — `useState` values are saved to `Pulumi.<stack>.yaml` config via a dynamic resource
6. **Middleware pipeline** — every `useState` change flows through pluggable middleware (persistence, action log, broadcast) enabling time travel, viz sync, and DevTools integration

React handles composition, conditional logic, loops, and component reuse. Pulumi handles the actual cloud diffing and deployment.

## Packages

| Package | Description |
|---------|-------------|
| `@react-pulumi/core` | React reconciler, resource tree, Pulumi bridge, `renderToPulumi`, state middleware |
| `@react-pulumi/cli` | CLI commands: `up`, `preview`, `destroy`, `viz` |
| `@react-pulumi/viz` | Web dashboard with resource graph, state timeline, deploy controls, time machine |

## Getting Started

### Prerequisites

- Node.js 20+
- [Pulumi CLI](https://www.pulumi.com/docs/install/)
- pnpm

### 1. Project setup

Create a new directory with these files:

**`package.json`**
```json
{
  "name": "my-infra",
  "private": true,
  "type": "module",
  "dependencies": {
    "@react-pulumi/core": "workspace:*",
    "@pulumi/pulumi": "^3.0.0",
    "@pulumi/random": "^4.0.0",
    "react": "^19.0.0"
  },
  "devDependencies": {
    "tsx": "^4.0.0"
  }
}
```

**`Pulumi.yaml`**
```yaml
name: my-infra
runtime:
  name: nodejs
  options:
    typescript: false
    nodeargs: "--import tsx"
main: index.tsx
```

**`tsconfig.json`**
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

### 2. Write infrastructure as JSX

**`index.tsx`**
```tsx
import React, { useState } from "react";
import * as pulumi from "@pulumi/pulumi";
import { pulumiToComponent, renderToPulumi, setPulumiSDK } from "@react-pulumi/core";
import * as random from "@pulumi/random";

setPulumiSDK(pulumi);

const [RandomPet] = pulumiToComponent(random.RandomPet);
const [RandomString] = pulumiToComponent(random.RandomString);

function App() {
  const [petLength] = useState(3);
  const [pwLength] = useState(16);

  return (
    <>
      <RandomPet name="my-pet" length={petLength} />
      <RandomString name="my-password" length={pwLength} special={true} />
    </>
  );
}

renderToPulumi(App)();
```

### 3. Deploy

```bash
pulumi login --local           # or pulumi login for Pulumi Cloud
pulumi stack init dev
pulumi up
```

On first run, `useState` defaults are used. After deploy, state is persisted:

```yaml
# Pulumi.dev.yaml (auto-generated)
config:
  react-pulumi:state: '{"keys":["App:0","App:1"],"values":[3,16]}'
```

Subsequent `pulumi up` runs read the persisted state — resources stay unchanged unless state changes.

### 4. Modify state

Edit the config value directly in `Pulumi.<stack>.yaml` to change state between runs:

```bash
pulumi config set react-pulumi:state '{"keys":["App:0","App:1"],"values":[5,32]}'
pulumi up   # petLength=5, pwLength=32
```

## Wrapping Pulumi resources

`pulumiToComponent` wraps a Pulumi resource class as a React FC and returns `[Component, Context]`:

```tsx
import * as aws from "@pulumi/aws";
import { useContext } from "react";
import { pulumiToComponent } from "@react-pulumi/core";

// Returns [Component, Context] — type token auto-extracted
const [Bucket, BucketCtx] = pulumiToComponent(aws.s3.Bucket);
const [BucketObject] = pulumiToComponent(aws.s3.BucketObject);

// Leaf resources — ignore Context
const [Instance] = pulumiToComponent(aws.ec2.Instance);
```

Resources are created at render time. Descendants read ancestor instances via Context:

```tsx
function BucketContents() {
  const bucket = useContext(BucketCtx);
  return <BucketObject name="index" bucket={bucket.id} objectKey="index.html" />;
}

<Bucket name="assets">
  <BucketContents />
</Bucket>

// Or use render props:
<Bucket name="assets">
  {(bucket) => <BucketObject name="index" bucket={bucket.id} objectKey="index.html" />}
</Bucket>
```

## Composition patterns

### Reusable components

```tsx
function VPC({ name, cidr }: { name: string; cidr: string }) {
  return (
    <Vpc name={name} cidrBlock={cidr}>
      <Subnet name={`${name}-public`} cidrBlock={cidr.replace(".0.0/16", ".0.0/20")} />
      <Subnet name={`${name}-private`} cidrBlock={cidr.replace(".0.0/16", ".16.0/20")} />
      <InternetGateway name={`${name}-igw`} />
    </Vpc>
  );
}
```

### Conditional resources

```tsx
function Database({ highAvailability }: { highAvailability: boolean }) {
  return (
    <>
      <RdsInstance name="primary" instanceClass="db.t3.medium" />
      {highAvailability && <RdsInstance name="replica" instanceClass="db.t3.medium" />}
    </>
  );
}
```

### Dynamic resource creation

```tsx
function MultiRegionBuckets({ regions }: { regions: string[] }) {
  return (
    <>
      {regions.map(region => (
        <Bucket name={`data-${region}`} region={region} key={region} />
      ))}
    </>
  );
}
```

### Persistent state with `useState`

```tsx
function App() {
  const [replicas] = useState(2);
  const [instanceType] = useState("t3.micro");

  return Array.from({ length: replicas }, (_, i) => (
    <Instance key={i} name={`web-${i}`} instanceType={instanceType} />
  ));
}
```

`useState` values persist to `Pulumi.<stack>.yaml` between `pulumi up` runs. Component structure changes (adding/removing/reordering hooks) trigger a warning and fall back to defaults.

## Using the CLI

Instead of `renderToPulumi` + `pulumi up`, you can use the react-pulumi CLI with a simpler export-based entry point:

```tsx
// infra.tsx — just export a component, no setPulumiSDK needed
import { pulumiToComponent, VizInput, VizButton } from "@react-pulumi/core";
import * as random from "@pulumi/random";
import { useState } from "react";

const [RandomPet] = pulumiToComponent(random.RandomPet);

export default function App() {
  const [count, setCount] = useState(2);
  return (
    <>
      <VizInput name="count" label="Pet Count" inputType="number"
        value={count} setValue={setCount} min={1} max={10} />
      <VizButton name="add" label="Add Pet"
        handler={() => setCount(n => Math.min(10, n + 1))} />
      {Array.from({ length: count }, (_, i) => (
        <RandomPet key={`pet-${i}`} name={`pet-${i}`} length={3} />
      ))}
    </>
  );
}
```

```bash
react-pulumi up infra.tsx             # deploy to 'dev' stack
react-pulumi up infra.tsx -s prod     # deploy to 'prod' stack
react-pulumi preview infra.tsx        # preview changes
react-pulumi destroy infra.tsx        # tear down
```

The CLI reads `Pulumi.yaml` from the entry file's directory. If one doesn't exist, it auto-creates it.

## Visualization

```bash
react-pulumi viz infra.tsx            # launch dashboard on :3000
react-pulumi viz infra.tsx -p 8080    # custom port
```

The viz dashboard is an interactive infrastructure control console:

- **Resource graph** — React Flow visualization of your infrastructure tree with deployment status indicators (green = deployed, amber = in progress, gray = pending)
- **Ghost nodes** — resources removed from code but still deployed appear as semi-transparent nodes with strikethrough names, showing exactly what will be deleted on next deploy
- **VizInput/VizButton controls** — interactive controls declared in JSX appear as editable nodes in the graph
- **Action/State History** — every state mutation is logged with diffs; deploy markers show which state is live
- **Preview/Deploy** — runs real `pulumi preview` / `pulumi up` via Automation API, shows per-resource change summary
- **Time machine** — click any history entry to preview that state; "Rollback to this" redeploys with historical values using current code

## Roadmap

- [x] React reconciler + resource tree
- [x] `pulumiToComponent` — `[Component, Context]` with render-time resource creation
- [x] Cross-resource Output wiring via `useContext` + render props
- [x] Provider scoping (`<AwsProvider>` context propagation)
- [x] `<Group>` for Pulumi ComponentResource
- [x] `renderToPulumi` — standard `pulumi up` compatibility
- [x] Persistent `useState` via `Pulumi.<stack>.yaml`
- [x] `react-pulumi` CLI (`up`, `preview`, `destroy`, `viz`)
- [x] State middleware pipeline (persistence, broadcast, action log)
- [x] Viz dashboard (resource graph + state timeline + deploy controls)
- [x] `VizInput` / `VizButton` — interactive controls in the graph
- [x] Resource deployment status indicators + ghost nodes
- [x] Persistent history + time machine with code change detection
- [x] `useConfig()` — read Pulumi stack config as a hook
- [x] `useStackOutput()` — cross-stack references
- [ ] `useReducer` persistence
- [ ] `useEffect` / `useDeployEffect` — post-deploy side effects
- [ ] `useSignal()` — webhook-driven state changes
- [ ] `useCron()` — time-based infrastructure
- [ ] `useMetric()` — metric-driven auto-scaling
- [ ] Deploy queue with serialization + debounce

## Tech stack

- **React 19** + **react-reconciler 0.31** — custom renderer
- **Pulumi 3** — cloud infrastructure engine
- **TypeScript** — strict mode, ESM
- **pnpm workspaces** + **Turborepo** — monorepo tooling
- **React Flow** (`@xyflow/react`) — graph visualization
- **Zustand** — state management for viz (with Redux DevTools integration)
- **Vitest** — testing
- **Biome** — linting + formatting

## License

MIT
