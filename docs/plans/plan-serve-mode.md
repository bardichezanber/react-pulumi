# Serve Mode — Daemon/Watch for Live Infrastructure

**Status:** Next phase. Depends on the one-shot `renderToPulumi` + persistent `useState` (implemented).

## The Core Insight

Currently `renderToResourceTree()` and `renderToPulumi()` are **one-shot**: render → tree → materialize → pulumi up → exit.

But React hooks assume a **render loop** — `setState` triggers re-render. If we control the loop, `useState` becomes a live infrastructure knob:

```tsx
function App() {
  const [machines, setMachines] = useState(2);
  return (
    <>
      {Array.from({ length: machines }, (_, i) => (
        <Instance key={i} name={`web-${i}`} type="t3.micro" />
      ))}
      <Action name="scale-up" handler={() => setMachines(n => n + 1)} />
      <Action name="scale-down" handler={() => setMachines(n => Math.max(1, n - 1))} />
    </>
  );
}
```

---

## Render Modes

### Mode 1: One-shot (implemented)

Two variants:
- `react-pulumi up app.tsx` — via CLI + `LocalWorkspace`
- `pulumi up` with `renderToPulumi(App)` — standard Pulumi, state in config

### Mode 2: Daemon (planned)

```bash
react-pulumi serve app.tsx
```

```
render → tree → materialize → pulumi up → wait for trigger
  ↑                                              ↓
  ←←←← re-render ←←←← setState ←←←←←←←←←←←←←←←
```

Process stays alive. State changes trigger re-render → new tree → diff against previous tree → `pulumi up` only if tree changed.

### Mode 3: Watch (planned)

```bash
react-pulumi watch app.tsx
```

Same as daemon but also re-renders on file change (like `vite dev` for infra). Useful during development.

---

## Trigger Sources

### 1. Actions (infrastructure exists, needs serve loop)

`<Action>` handlers call `setState` → re-render → deploy.

Triggered via:
- Viz dashboard button click
- REST API: `POST /actions/scale-up`
- CLI: `react-pulumi action scale-up`

```tsx
function App() {
  const [replicas, setReplicas] = useState(2);
  const [instanceType, setInstanceType] = useState("t3.micro");

  return (
    <>
      {Array.from({ length: replicas }, (_, i) => (
        <Instance key={i} name={`web-${i}`} type={instanceType} />
      ))}
      <Action name="scale-up" handler={() => setReplicas(n => n + 1)} />
      <Action name="scale-down" handler={() => setReplicas(n => Math.max(1, n - 1))} />
      <Action name="upgrade" handler={() => setInstanceType("t3.large")} />
    </>
  );
}
```

### 2. `useConfig` — Pulumi Config as hook

Read from Pulumi stack config. Re-render when config changes.

```tsx
function App() {
  const region = useConfig("aws:region");
  const replicas = useConfig("replicas", 2);
  return Array.from({ length: replicas }, (_, i) => (
    <Instance key={i} name={`web-${region}-${i}`} />
  ));
}
```

Implementation: wraps `pulumi.Config`. In daemon mode, watches `Pulumi.<stack>.yaml` for changes.

### 3. `useStackOutput` — Cross-stack references

```tsx
function App() {
  const vpcId = useStackOutput("org/network/prod", "vpcId");
  const subnetIds = useStackOutput("org/network/prod", "subnetIds");
  return (
    <SecurityGroup name="web-sg" vpcId={vpcId}>
      {subnetIds.map((id: string) => (
        <Instance key={id} name={`web-${id}`} subnetId={id} />
      ))}
    </SecurityGroup>
  );
}
```

Implementation: wraps `pulumi.StackReference`. In daemon mode, polls upstream stack outputs on interval.

### 4. `useSignal` — External event sources

```tsx
function App() {
  const desiredCount = useSignal("desired-count", 2);
  return Array.from({ length: desiredCount }, (_, i) => (
    <Instance key={i} name={`worker-${i}`} />
  ));
}
```

Signal sources: webhook (`POST /signals/:name`), metric (CloudWatch/Datadog), queue (SQS/Redis), cron.

### 5. `useCron` — Time-based infrastructure

```tsx
function App() {
  const isBusinessHours = useCron("0 9-17 * * MON-FRI");
  return (
    <>
      <Instance name="web-0" type="t3.micro" />
      {isBusinessHours && (
        <>
          <Instance name="web-1" type="t3.micro" />
          <Instance name="web-2" type="t3.micro" />
        </>
      )}
    </>
  );
}
```

---

## `useEffect` / `useDeployEffect` — Post-deploy side effects

`useEffect` runs after the tree is committed. In react-pulumi, "committed" = after `materializeTree()` + `pulumi up`.

Two phases proposed:
- `useEffect` → runs after tree commit (sync, like React DOM)
- `useDeployEffect` → runs after successful `pulumi up` (async, new hook)

```tsx
useDeployEffect(async (result) => {
  await fetch("https://slack.com/webhook", {
    method: "POST",
    body: JSON.stringify({ text: `Deployed: ${result.summary}` }),
  });
}, [version]);
```

---

## `useReducer` — State machines for infrastructure

```tsx
type InfraAction =
  | { type: "SCALE"; replicas: number }
  | { type: "START_CANARY" }
  | { type: "PROMOTE" }
  | { type: "ROLLBACK" };

function infraReducer(state: InfraState, action: InfraAction): InfraState {
  switch (action.type) {
    case "SCALE": return { ...state, replicas: action.replicas };
    case "START_CANARY": return { ...state, greenWeight: 10, blueWeight: 90 };
    case "PROMOTE": return { ...state, stage: "green", greenWeight: 100, blueWeight: 0 };
    case "ROLLBACK": return { ...state, greenWeight: 0, blueWeight: 100 };
  }
}

function App() {
  const [state, dispatch] = useReducer(infraReducer, initialState);
  return (
    <>
      <TargetGroup name="blue" weight={state.blueWeight}>...</TargetGroup>
      <TargetGroup name="green" weight={state.greenWeight}>...</TargetGroup>
      <Action name="start-canary" handler={() => dispatch({ type: "START_CANARY" })} />
      <Action name="promote" handler={() => dispatch({ type: "PROMOTE" })} />
      <Action name="rollback" handler={() => dispatch({ type: "ROLLBACK" })} />
    </>
  );
}
```

---

## `useStore` — Persistent state (disk-backed)

Unlike `useState` (which persists to Pulumi config via `renderToPulumi`), `useStore` persists to a dedicated state file. Useful for deployment counters, timestamps, etc.

```tsx
function App() {
  const [deployCount, setDeployCount] = useStore("deployCount", 0);
  const [lastDeployedAt, setLastDeployedAt] = useStore("lastDeployedAt", "");

  useDeployEffect(() => {
    setDeployCount(n => n + 1);
    setLastDeployedAt(new Date().toISOString());
  });

  return <Instance name="web" tags={{ deployCount, lastDeployedAt }} />;
}
```

---

## Render Loop Implementation

### Daemon loop pseudocode

```typescript
async function serve(element: ReactElement) {
  let tree = renderToResourceTree(element);
  let prevTree = null;

  while (true) {
    if (treeChanged(tree, prevTree)) {
      await materializeAndDeploy(tree);
      prevTree = tree;
    }

    await Promise.race([
      actionTriggered(),
      configChanged(),
      signalReceived(),
      cronFired(),
      metricPolled(),
    ]);

    tree = renderToResourceTree(element);
  }
}
```

### Deploy serialization

Multiple triggers may fire in quick succession. Deploys must be serialized:

```
trigger → setState → re-render → enqueue deploy
                                       ↓
                              deploy queue (serial)
                                       ↓
                              pulumi up → done → process next
```

Debounce: batch multiple `setState` calls during active deploy into one re-render after completion.

---

## Safety Rails

### 1. Preview before apply

Daemon mode should run `pulumi preview` first. Auto-apply only if:
- Resource count delta within threshold (e.g., ±3)
- No deletions of protected resources
- User configured auto-apply for this action

```tsx
<Action
  name="scale-up"
  handler={() => setReplicas(n => n + 1)}
  autoApply={true}
  maxDelta={5}
/>
```

### 2. Rate limiting

Prevent runaway re-renders from metric-driven hooks:

```tsx
const cpuAvg = useMetric("cloudwatch", {
  metric: "CPUUtilization",
  period: "5m",
  cooldown: "10m",
});
```

### 3. Dry-run mode

```bash
react-pulumi serve app.tsx --dry-run  # preview only, never apply
```

---

## Implementation Priority

### Phase 1 — Render loop + Actions (enables everything else)
1. Refactor renderer to support re-render (keep container/fiber tree alive)
2. `react-pulumi serve` daemon command
3. Actions trigger `setState` → re-render → deploy
4. Deploy queue with serialization + debounce

### Phase 2 — Config + Stack hooks
5. `useConfig()` — read from Pulumi config
6. `useStackOutput()` — cross-stack references
7. `useStore()` — persistent state

### Phase 3 — External triggers
8. `useSignal()` — webhook-driven state
9. `useCron()` — time-based re-render
10. `useMetric()` — metric-driven auto-scaling

### Phase 4 — Deploy lifecycle
11. `useDeployEffect()` — post-deploy side effects
12. Preview gate + auto-apply rules
13. Deploy history + rollback

---

## Open Questions

1. **Multi-stack coordination** — `setState` in one stack triggers deploy in another?
2. **Error recovery** — if `pulumi up` fails, rollback state or keep and retry?
3. **Testing** — how to test hooks without actual cloud deploys? Mock `useMetric` returns?
4. **Output feedback** — can `useEffect` read Pulumi resource outputs (e.g., assigned IP) and feed back into state? Creates render → deploy → output → re-render cycle.
