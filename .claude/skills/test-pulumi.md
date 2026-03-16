---
name: test-pulumi
description: Run E2E tests on react-pulumi examples using a local Pulumi stack. Use this skill whenever the user asks to test an example with `pulumi up`, `react-pulumi up`, verify a deployment, or do an E2E smoke test against a real (local) Pulumi backend. Also trigger when the user says "test basic", "test with-pulumi", "test the example", or any variant involving running Pulumi commands against the examples/ directory.
---

# Test react-pulumi examples with local Pulumi stack

This skill runs a full deploy → verify → destroy cycle against a local Pulumi backend. It works for both deployment modes:

- **`pulumi up` mode** — examples that use `renderToPulumi()` + `Pulumi.yaml` (e.g., `examples/basic/`)
- **`react-pulumi up` mode** — examples that export a default component (e.g., `examples/basic-with-react-pulumi-cli/`)

## Pre-flight

1. Build the project first so compiled output is fresh:
   ```bash
   pnpm -r build
   ```
2. Detect which mode the example uses:
   - Has `Pulumi.yaml` → standard Pulumi mode
   - Has `"react-pulumi up"` in package.json scripts → CLI mode
   - Both may exist; prefer the one the user asks about

## Standard Pulumi mode (`pulumi up`)

For examples with `Pulumi.yaml` (like `examples/basic/`):

```bash
cd <example-dir>

# 1. Login to local backend (no cloud account needed)
pulumi login --local

# 2. Create stack
PULUMI_CONFIG_PASSPHRASE="" pulumi stack init dev

# 3. Deploy
PULUMI_CONFIG_PASSPHRASE="" pulumi up --yes

# 4. Verify idempotency — second run should show 0 changes
PULUMI_CONFIG_PASSPHRASE="" pulumi up --yes

# 5. If the example uses renderToPulumi with useState, verify state persistence:
PULUMI_CONFIG_PASSPHRASE="" pulumi config get react-pulumi:state
# Should show JSON like: {"keys":["App:0","App:1"],"values":[3,16]}

# 6. Clean up
PULUMI_CONFIG_PASSPHRASE="" pulumi destroy --yes
PULUMI_CONFIG_PASSPHRASE="" pulumi stack rm dev --yes
```

### What to check

- `pulumi up` creates the expected number of resources (no errors)
- Second `pulumi up` shows all resources **unchanged** (idempotent)
- If `renderToPulumi` + `useState` is used: `react-pulumi:state` config key exists in `Pulumi.<stack>.yaml` with correct keys/values
- `pulumi destroy` removes all resources cleanly

## react-pulumi CLI mode (`react-pulumi up`)

For examples that use the CLI (like `examples/basic-with-react-pulumi-cli/`):

```bash
cd <example-dir>

# 1. Deploy (CLI handles login + stack creation via LocalWorkspace)
PULUMI_CONFIG_PASSPHRASE="" npx react-pulumi up ./index.tsx

# 2. Verify idempotency
PULUMI_CONFIG_PASSPHRASE="" npx react-pulumi up ./index.tsx

# 3. Clean up
PULUMI_CONFIG_PASSPHRASE="" npx react-pulumi destroy ./index.tsx
```

### What to check

- First run shows `Resources: {"create": N}`
- Second run shows `Resources: {"same": N}` (idempotent)
- Destroy shows `Summary: {"delete": N}`

## Environment notes

- `PULUMI_CONFIG_PASSPHRASE=""` is required for local backend in non-interactive mode (empty passphrase)
- `pulumi login --local` only needs to run once per session — check if already logged in before running
- Always `cd` into the example directory before running Pulumi commands (Pulumi reads `Pulumi.yaml` from cwd)
- Set timeout to 120s for deploy commands — plugin downloads can be slow on first run
- Run commands with `dangerouslyDisableSandbox: true` since Pulumi needs network + filesystem access beyond the sandbox

## Reporting results

After testing, report a summary table:

```
| Step             | Result           |
|------------------|------------------|
| Build            | OK               |
| Deploy           | N resources created |
| Idempotency      | N unchanged      |
| State persistence| OK / N/A         |
| Destroy          | N deleted        |
| Stack cleanup    | OK               |
```
