# Design System — react-pulumi viz

## Product Context
- **What this is:** Infrastructure-as-code state machine visualizer and control console
- **Who it's for:** DevOps / SRE engineers
- **Space:** IaC tooling (Pulumi, Terraform, CloudFormation dashboards)
- **Project type:** Developer tool dashboard — React Flow graph + interactive controls + deploy timeline

## Aesthetic Direction
- **Direction:** Industrial / Utilitarian
- **Decoration:** Minimal — typography and spacing do all the work
- **Mood:** A real control console. Precise, dense, trustworthy. Not a marketing page.
- **References:** Vercel dashboard, Grafana, terminal emulators

## Node Taxonomy

The React Flow graph is the primary UI surface. Every node type has a distinct visual treatment.

### Infrastructure Resources
Nodes created by `pulumiToComponent` — the actual cloud resources.

```
┌─────────────────────────────┐
│ aws:ec2/instance:Instance   │  ← type token (monospace, muted)
│ production-web-0            │  ← logical name (bold)
└─────────────────────────────┘
```
- **Border:** 1px solid `--border`
- **Background:** `--surface`
- **Text:** type token in `--text-muted`, name in `--text`

### Component Wrappers
React components from `pulumiToComponent` that have children (VPC, Subnet).

```
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐
  aws:ec2/vpc:Vpc               ← dashed border = wrapper, not leaf
│ production-vpc              │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘
```
- **Border:** 1px dashed `--accent` (or component-specific color)
- **Background:** transparent or `--surface` at 50% opacity

### VizInput (Interactive State Node)
Inline-editable node in the tree. Shows current value + allows direct editing.

```
┌─────────────────────────────┐
│ ○ replicas          [ 3 ]▾  │  ← label + editable value
│   range: 1–10               │  ← constraint hint (optional)
└─────────────────────────────┘
```
- **Border:** 1px solid `--accent`
- **Left indicator:** small circle `○` in `--accent` (distinguishes from resource nodes)
- **Value field:** inline input, monospace, right-aligned
- **On edit:** border glows `--accent`, value updates, triggers re-render
- **Background:** `--surface` with subtle `--accent-muted` tint

### VizButton (Action Node)
Clickable action node in the tree. Triggers a handler (e.g., scale up/down).

```
┌─────────────────────────────┐
│ ▶ Scale Up (+1)             │  ← play icon + label
└─────────────────────────────┘
```
- **Border:** 1px solid `--border`, dashed
- **Left indicator:** `▶` in `--text-muted`
- **On hover:** border becomes `--accent`, cursor pointer
- **On click:** brief flash of `--accent-muted` background, triggers handler + re-render

### Edges
- **Parent → child:** solid line, `--border` color
- **Component wrapper → children:** animated dashed line
- **VizInput/VizButton → sibling resources:** no edge (they are peers, not parents)

## Typography
- **Display / Headings:** Geist — clean, modern, built for developer tools
- **Body:** Geist — same family for consistency
- **Data / Code / Values:** Geist Mono — monospace, supports tabular-nums
- **Loading:** Google Fonts CDN (`family=Geist:wght@400;500;600;700&family=Geist+Mono`)
- **Scale:**
  - `--text-xs:` 10px — timestamps, IDs
  - `--text-sm:` 11px — labels, badges, secondary
  - `--text-base:` 13px — body, node content
  - `--text-lg:` 14px — section titles
  - `--text-xl:` 16px — page title
  - `--text-display:` 20px — hero (rarely used)

## Color
- **Approach:** Restrained — 1 accent + neutrals + semantic. Color is rare and meaningful.

### Core Palette
| Token | Hex | Usage |
|-------|-----|-------|
| `--bg` | `#0a0a0a` | Page background |
| `--surface` | `#141414` | Cards, panels, nodes |
| `--surface-raised` | `#1a1a1a` | Elevated surfaces, hover |
| `--border` | `#262626` | Dividers, node borders |
| `--border-hover` | `#3a3a3a` | Hover state borders |
| `--text` | `#ededed` | Primary text |
| `--text-muted` | `#888888` | Secondary text, labels |
| `--text-dim` | `#555555` | Tertiary, timestamps |
| `--accent` | `#0ea5e9` | Interactive elements, VizInput borders, selection |
| `--accent-hover` | `#38bdf8` | Accent hover state |
| `--accent-muted` | `rgba(14,165,233,0.15)` | Accent backgrounds, VizInput tint |

### Semantic Colors
| Token | Hex | Usage |
|-------|-----|-------|
| `--success` | `#22c55e` | Deploy success, WS connected |
| `--error` | `#ef4444` | Deploy failed, errors |
| `--warning` | `#f59e0b` | Warnings, security groups (dashed) |
| `--info` | `#6366f1` | Preview results, informational |

### Dark Mode
Dark-first. No light mode planned (DevOps tools live in dark terminals).

## Spacing
- **Base unit:** 4px
- **Density:** Compact — developer tools need data density
- **Scale:** 2xs(2) xs(4) sm(8) md(12) lg(16) xl(24) 2xl(32) 3xl(48)

## Layout

### Dashboard Structure
```
┌──────────────────────────────────────────────────────────┐
│  ControlPanel: [WS] [Status] [Deploy] [Preview]         │  40px
├──────────────────────────────────┬───────────────────────┤
│                                  │  Action/State Timeline │
│  React Flow Graph                │                       │
│  (interactive resource tree)     │  ● VizButton:scale-up │
│                                  │    replicas: 2 → 3    │
│  Nodes:                          │                       │
│  ├ VizInput (editable inline)    │  ● VizInput:region    │
│  ├ VizButton (clickable)         │    "us-west" → "eu-w" │
│  ├ Resource (display only)       │                       │
│  └ Component (wrapper, dashed)   │  ● VizButton:scale-up │
│                                  │    replicas: 3 → 4    │
│                                  │                       │
│                                  │  ─── deployed ───     │  ← deployed marker
│                                  │                       │
│                                  │  ● initial render     │
│                                  │    replicas: 2         │
│                                  │    region: "us-west"   │
├──────────────────────────────────┴───────────────────────┤
│  Legend: ■ Resource  ┆┆ Component  ○ Input  ▶ Button     │  32px
└──────────────────────────────────────────────────────────┘
```

- **Graph area:** flex: 1, takes remaining space
- **Right panel:** 320-360px fixed width, scrollable, contains Timeline (always) and Preview Result (when available, shown above Timeline as a transient banner)
- **Control panel:** single row, top, 40px height
- **Legend:** bottom bar, merged with React Flow controls
- **Preview result:** Shown as a summary banner at top of right panel: `+2 create, ~1 update, -0 delete`. Disappears on next action or deploy. Uses `--info` color for the banner border.

### Grid
- **Approach:** Grid-disciplined
- **Right panel:** single column, sections separated by `--border`
- **Max content width:** none (full viewport)
- **Border radius:** sm: 4px, md: 6px, lg: 8px

## Motion
- **Approach:** Minimal-functional
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)
- **Duration:** micro(50ms) short(150ms) medium(250ms)
- **Used for:**
  - Node hover → border color transition (short)
  - VizInput edit → value change highlight flash (medium)
  - VizButton click → background flash (micro)
  - Deploy status change → status label transition (short)
  - Timeline entry appear → fade in (medium)
- **Never used for:** page transitions, loading spinners, decorative animation

## Interaction States

| Feature | Loading | Empty | Error | Success | Partial |
|---------|---------|-------|-------|---------|---------|
| **Graph** | Centered spinner + "Rendering..." in `--text-muted` | "No resources yet. Run `react-pulumi viz` with a TSX file." + code example | "Render failed: {error}" in `--error` with retry button | Graph renders normally | Graph shows with WS disconnected badge |
| **Timeline** | Skeleton lines (3 pulsing bars) | "No actions yet. Edit a VizInput or click a VizButton to see state changes here." | "Failed to load history" in `--error` | Entries appear with fade-in (medium) | Shows entries but deploy marker missing = "never deployed" note |
| **ControlPanel** | Deploy button shows spinner + "Deploying..." | Normal idle state | "Deploy failed" toast/banner in `--error`, auto-dismiss 5s | "Deployed ✓" flash in `--success` on status label, 3s | WS disconnected: dot turns `--error`, label "Reconnecting..." |
| **VizInput** | N/A (synchronous render) | Shows default value from useState | N/A | Value updates, brief accent border flash (medium) | N/A |
| **VizButton** | Brief `--accent-muted` background during handler | N/A | Handler threw: border flashes `--error` briefly | Background flash `--accent-muted` (micro) | N/A |
| **Preview** | Right panel shows "Running preview..." with spinner | N/A | "Preview failed: {error}" banner in `--error` | Summary banner: "+2 create, ~1 update" in `--info` | N/A |
| **WebSocket** | N/A | N/A | Auto-reconnect with "Reconnecting..." label | Green dot + "Connected" | Replay in progress: "Syncing..." label |

## Component Specifications

### ControlPanel (top bar)
- Height: 40px
- Background: `--surface`
- Border-bottom: 1px solid `--border`
- Items: WS indicator (6px dot), status label (monospace), Deploy button (primary), Preview button (ghost)

### Timeline (right panel — Action/State History)

The timeline is a **reverse-chronological log of every state mutation**, not just deploys.
Each entry records who triggered it (which VizButton or VizInput), what changed, and the
resulting state. A "deployed" marker shows which state is actually live in the cloud.

```
Timeline Entry Types:
  ● action  — VizButton click or VizInput edit (user-initiated)
  ◆ deploy  — successful pulumi up (marks which state is live)
  ✗ failed  — failed deploy attempt
  ○ initial — first render state (bottom of timeline)
```

**Entry layout:**
```
┌─────────────────────────────────────┐
│ ● VizButton:scale-up       16:30:22│  ← trigger + timestamp
│   replicas: 2 → 3                  │  ← state diff (monospace)
│   region: "us-west-2" (unchanged)  │  ← unchanged values shown dim
└─────────────────────────────────────┘
```

**Deploy marker (inline separator):**
```
─────── ◆ deployed (d8f2a1b3) ───────
```
Shows between the last action that was deployed and the next pending action.
Actions above the marker are **pending** (changed but not deployed).
Actions below the marker are **deployed** (live in cloud).

- Section header: `ACTION / STATE HISTORY`, uppercase, `--text-sm`, `--text-muted`
- Action entry: trigger name (`--text`, font-weight 500), timestamp (`--text-dim`, monospace, right-aligned)
- State diff: key-value pairs in monospace. Changed values in `--text`, unchanged in `--text-dim`
- Arrow notation: `oldValue → newValue` for changes
- Deploy marker: horizontal rule with `◆ deployed (short-id)` centered, `--success` color
- Failed deploy marker: same but `✗ failed`, `--error` color
- Pending actions (above deploy marker): normal styling
- Initial render entry: `○ initial render` at bottom, lists all initial state values
- Scrollable, newest at top
- **Selection = preview:** Clicking a timeline entry enters "time travel preview" mode:
  - Graph's VizInput nodes show that entry's historical values (read-only, dimmed input fields)
  - Resource tree re-renders to match that state (e.g., if replicas was 2, show 2 Instance nodes)
  - ControlPanel shows "Previewing deploy d8f2..." in `--info` color
  - Selected entry has `--accent-muted` background + left border `--accent`
  - Two action buttons appear: "Rollback to this" (writes config + deploys) and "Back to current" (exits preview)
  - Clicking "Back to current" or clicking the same entry again exits preview mode

### Resource Node (React Flow)
- Min width: 200px
- Padding: 6px 12px
- Type token: `--text-xs`, monospace, `--text-muted`
- Name: `--text-base`, font-weight 500

### VizInput Node (React Flow)
- Same dimensions as resource node
- Left: accent circle indicator (6px)
- Label: `--text-sm`, `--text-muted`
- Value: inline input field, monospace, right-aligned, `--text-base`
- Editable on click — input gains focus, border changes to `--accent`
- On blur/enter: triggers setter + re-render

### VizButton Node (React Flow)
- Same dimensions as resource node
- Left: `▶` indicator, `--text-muted`
- Label: `--text-base`, font-weight 500
- Dashed border (distinguishes from resources)
- On hover: border solid `--accent`
- On click: background flash `--accent-muted`, triggers handler

### ControlPanel (top bar)
Deploy button's label reflects pending state:
- No pending changes: `Deploy` (disabled or dimmed)
- Pending changes exist: `Deploy (3 changes)` (enabled, shows count of actions above deploy marker)

## Responsive

- **Primary viewport:** Desktop (1280px+) — full 3-column layout as specified
- **< 1024px:** Right panel (Timeline) collapses to a slide-over overlay, toggled by a tab/button at the right edge of the graph. Graph takes full width.
- **< 768px:** ControlPanel stacks vertically (WS status on its own row). Legend hides behind a `?` toggle. Not a primary use case — acceptable degradation.
- **No mobile-specific layout.** This is a desktop-first developer tool.

## Accessibility

- **Keyboard navigation:** Tab navigates between React Flow nodes. Enter activates VizInput edit mode. Space triggers VizButton. Escape cancels VizInput edit.
- **ARIA landmarks:** `role="main"` on graph area, `role="complementary"` on timeline panel, `role="toolbar"` on ControlPanel.
- **Focus indicators:** 2px solid `--accent` outline on focused nodes (replaces default browser outline).
- **Contrast:** All text passes WCAG AA. `--text` (#ededed) on `--bg` (#0a0a0a) = 18.1:1. `--text-muted` (#888) on `--surface` (#141414) = 5.3:1. `--text-dim` (#555) on `--surface` = 3.0:1 (decorative only, not for essential info).
- **Touch targets:** All interactive nodes min 44px height (already satisfied by 6px+12px padding on ~13px text).
- **Screen readers:** Node type + name announced. VizInput announces label + current value. VizButton announces label + "button". Timeline entries announce trigger + state diff.

## User Journey

| Step | User Does | User Feels | Design Supports |
|------|-----------|------------|-----------------|
| 1. Launch | Runs `react-pulumi viz app.tsx` | Curious — "what will I see?" | Fast startup, graph renders immediately |
| 2. Orient | Scans the graph | Oriented — "I see my infrastructure" | Clear node taxonomy, hierarchy readable at a glance |
| 3. Discover controls | Notices VizInput/VizButton nodes | Empowered — "I can change things" | Accent border + ○/▶ indicators distinguish from resources |
| 4. First edit | Changes a VizInput value | Immediate feedback — "it responded" | Graph re-renders, timeline logs the action, value updates |
| 5. Click action | Clicks Scale Up button | Satisfying — "that was easy" | Background flash, new Instance nodes appear, timeline entry |
| 6. Review changes | Reads timeline | Informed — "I see exactly what changed" | State diff with arrow notation, pending marker clear |
| 7. Deploy | Clicks Deploy (3 changes) | Confident — "I know what I'm shipping" | Pending count on button, deploy marker moves in timeline |
| 8. Deploy succeeds | Sees success status | Relieved — "it worked" | Green flash on status, deploy marker appears in timeline |
| 9. Return visit | Opens dashboard again | Familiar — "I remember this" | Timeline shows full history, WS reconnects, state restored |

**First 5 seconds (visceral):** Dark, dense, professional. "This is a real tool, not a toy."
**5 minutes (behavioral):** Controls are discoverable, edits are instant, timeline is trustworthy.
**Long-term (reflective):** "This is how I manage my infrastructure state."

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-30 | Dark-first, no light mode | DevOps tools used in terminal-adjacent environments |
| 2026-03-30 | Geist + Geist Mono | Built for developer tools, pairs well with IaC aesthetic |
| 2026-03-30 | VizInput/VizButton as tree nodes | State controls belong where they live in the component hierarchy |
| 2026-03-30 | Single accent color (sky-500) | Restrained palette — every color usage is meaningful |
| 2026-03-30 | Compact spacing (4px base) | Data density is a feature for DevOps dashboards |
| 2026-03-30 | Timeline = action/state history, not deploy history | Every VizButton click and VizInput edit is a logged event with state diff. Deploy marker shows which state is live. Pending vs deployed is the key distinction. |
