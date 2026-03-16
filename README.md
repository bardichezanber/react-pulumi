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

## How it works

1. **`pulumiToComponent`** wraps Pulumi resource classes as React FCs that return `[Component, Context]`
2. **React reconciler** renders your JSX — resources are created at render time as side effects
3. **Context** provides resource instances to descendants — `useContext(VcnCtx)` reads the nearest ancestor
4. **Pulumi engine** diffs against cloud state and applies changes
5. **State persistence** — `useState` values are saved to `Pulumi.<stack>.yaml` config via a dynamic resource

React handles composition, conditional logic, loops, and component reuse. Pulumi handles the actual cloud diffing and deployment.

## Packages

| Package | Description |
|---------|-------------|
| `@react-pulumi/core` | React reconciler, resource tree, Pulumi bridge, `renderToPulumi` |
| `@react-pulumi/cli` | CLI commands: `up`, `preview`, `destroy`, `viz` |
| `@react-pulumi/viz` | Web dashboard with resource graph visualization |

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

## Using the CLI (alternative)

Instead of `renderToPulumi` + `pulumi up`, you can use the react-pulumi CLI with a simpler export-based entry point:

```tsx
// infra.tsx — just export a component, no setPulumiSDK needed
import { pulumiToComponent } from "@react-pulumi/core";
import * as random from "@pulumi/random";

const [RandomPet] = pulumiToComponent(random.RandomPet);

export default function App() {
  return <RandomPet name="my-pet" length={3} />;
}
```

```bash
react-pulumi up infra.tsx             # deploy to 'dev' stack
react-pulumi up infra.tsx -s prod     # deploy to 'prod' stack
react-pulumi preview infra.tsx        # preview changes
react-pulumi destroy infra.tsx        # tear down
```

Note: the CLI approach does not support `useState` persistence. Use `renderToPulumi` for stateful components.

## Visualization

```bash
react-pulumi viz infra.tsx            # launch dashboard on :3000
```

The viz dashboard shows a real-time resource graph powered by React Flow, with deployment status tracking via Zustand.

## Roadmap

- [x] React reconciler + resource tree
- [x] Pulumi bridge (`materializeTree` — legacy host-component path)
- [x] `pulumiToComponent` returns `[Component, Context]` — render-time resource creation + Context
- [x] Cross-resource Output wiring via `useContext`
- [x] Render props mode: `<Vcn>{(vcn) => <Subnet vcnId={vcn.id} />}</Vcn>`
- [x] Provider scoping (`<AwsProvider>` context propagation)
- [x] `<Group>` for Pulumi ComponentResource
- [x] `renderToPulumi` — standard `pulumi up` compatibility
- [x] Persistent `useState` via `Pulumi.<stack>.yaml`
- [x] `react-pulumi` CLI (`up`, `preview`, `destroy`, `viz`)
- [x] Viz dashboard (React Flow graph + Zustand store)
- [ ] `react-pulumi serve` — daemon mode with re-render loop
- [ ] Actions trigger `setState` → re-render → deploy
- [ ] `useReducer` persistence
- [x] `useConfig()` — read Pulumi stack config as a hook
- [x] `useStackOutput()` — cross-stack references
- [ ] `useEffect` / `useDeployEffect` — post-deploy side effects
- [ ] `useSignal()` — webhook-driven state changes
- [ ] `useCron()` — time-based infrastructure
- [ ] `useMetric()` — metric-driven auto-scaling
- [ ] Deploy queue with serialization + debounce
- [ ] Preview gate + auto-apply safety rails

See [docs/plan-serve-mode.md](docs/plan-serve-mode.md) for detailed design.

## Tech stack

- **React 19** + **react-reconciler 0.31** — custom renderer
- **Pulumi 3** — cloud infrastructure engine
- **TypeScript** — strict mode, ESM
- **pnpm workspaces** + **Turborepo** — monorepo tooling
- **React Flow** (`@xyflow/react`) — graph visualization
- **Zustand** — state management for viz
- **Vitest** — testing

## License

MIT
