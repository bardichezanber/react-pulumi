# Hooks Design Plan

## Status

### Implemented: Persistent `useState` via `renderToPulumi`

Standard React `useState` now persists across `pulumi up` runs via `Pulumi.<stack>.yaml` config.

```tsx
import { useState } from "react";
import { renderToPulumi, setPulumiSDK, pulumiToComponent } from "@react-pulumi/core";

function App() {
  const [replicas, setReplicas] = useState(2);
  return Array.from({ length: replicas }, (_, i) => (
    <Instance key={i} name={`web-${i}`} instanceType="t3.micro" />
  ));
}

export default renderToPulumi(App);
```

**Architecture:**
```
Pulumi.<stack>.yaml
    ↓ (program start)
pulumi.Config.get("react-pulumi:state")     [sync read]
    ↓
loadState(parsed) → installInterceptor()    [hijack React.useState]
    ↓
renderToResourceTree(App)                    [useState returns hydrated values]
    ↓
collectHookKeys(fiberRoot)                   [validate structure via fiber walk]
    ↓
materializeTree(tree)                        [create user resources]
    ↓
new pulumi.dynamic.Resource(...)             [state hook resource]
    ↓ (deploy success → provider.create/update)
pulumi config set react-pulumi:state '...'   [write back to yaml]
```

**Key files:**
- `packages/core/src/render-to-pulumi.ts` — orchestrator
- `packages/core/src/state-store.ts` — in-memory store
- `packages/core/src/state-interceptor.ts` — React dispatcher proxy
- `packages/core/src/renderer.ts` — `collectHookKeys()` fiber walk

**Known limitations:**
1. React internals dependency — `__CLIENT_INTERNALS_...H` proxy, pinned to React 19
2. `execSync('pulumi config set')` — requires Pulumi CLI in PATH
3. Hook ordering — same as React hooks rule; key mismatch triggers warning + fallback
4. State serialized as JSON string in config — large state makes YAML verbose

---

### Implemented: `useConfig`

Read Pulumi stack config values during render. Supports namespaced keys.

```tsx
import { useConfig } from "@react-pulumi/core";

function App() {
  const region = useConfig("aws:region");             // reads aws:region from config
  const replicas = useConfig("replicas", "2");        // project namespace, default "2"

  return Array.from({ length: Number(replicas) }, (_, i) => (
    <Instance key={i} name={`web-${region}-${i}`} />
  ));
}
```

**Key parsing:**
- `"replicas"` → `new pulumi.Config()` (project namespace) → `.get("replicas")`
- `"aws:region"` → `new pulumi.Config("aws")` → `.get("region")`

Config instances are cached per namespace within a render. Cache is reset between `renderToPulumi` calls.

**Key files:**
- `packages/core/src/hooks/useConfig.ts`

---

### Implemented: `useStackOutput`

Read outputs from another Pulumi stack. Returns a `pulumi.Output<T>` that resolves during `pulumi up`.

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

- Returns `pulumi.Output<T>` — pass directly into resource props
- StackReference instances are cached per stack name within a render
- Multiple calls to the same stack reuse a single `StackReference`

**Key files:**
- `packages/core/src/hooks/useStackOutput.ts`

---

## Standard React Hooks — behavior in one-shot mode

| Hook | Behavior |
|------|----------|
| `useState` | Persisted via `renderToPulumi` + config. One-shot (no re-render). |
| `useReducer` | Same as `useState` — initial value only in one-shot mode |
| `useMemo` | Compute during render. Works normally. |
| `useRef` | Mutable ref, but no persistence across runs |
| `useContext` | Provider inheritance. Works normally. |
| `useCallback` | Stable handler refs. Works normally. |
| `useEffect` | Not yet supported in one-shot mode |

## Custom Hooks — one-shot mode

| Hook | Behavior |
|------|----------|
| `useConfig(key, default?)` | Reads Pulumi stack config. Sync. |
| `useStackOutput(stack, key)` | Returns `pulumi.Output<T>` from another stack. |

---

## Next Phase

See [plan-serve-mode.md](./plan-serve-mode.md) for the serve/daemon mode design, which enables:
- Re-render loop (`setState` triggers re-deploy)
- Actions as live triggers (viz dashboard → `setState` → `pulumi up`)
- `useConfig` with file-watching (re-render on config change)
- `useStackOutput` with polling (re-render on upstream update)
- Custom hooks: `useSignal`, `useMetric`, `useCron`
- `useEffect` / `useDeployEffect` post-deploy side effects
- `useStore` persistent state (separate from `useState` config persistence)
