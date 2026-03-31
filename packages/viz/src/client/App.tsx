/**
 * App — dashboard layout per DESIGN.md.
 *
 * ┌──────────────────────────────────────────────┐
 * │  ControlPanel (40px)                          │
 * ├──────────────────────────┬───────────────────┤
 * │  React Flow Graph        │  Timeline (340px) │
 * ├──────────────────────────┴───────────────────┤
 * │  Legend (32px)                                │
 * └──────────────────────────────────────────────┘
 */

import "./design-tokens.css";
import type { ResourceNode } from "@react-pulumi/core";
import { useEffect } from "react";
import { useInfraStore } from "../infra-store.js";
import { useWebSocket } from "../ws-client.js";
import { ResourceGraph } from "../web-renderer.js";
import { ControlPanel } from "./ControlPanel.js";
import { Timeline } from "./Timeline.js";
import type { DeploymentStatus } from "../types.js";

export function App() {
  useWebSocket();

  const resourceTree = useInfraStore((s) => s.resourceTree);
  const setResourceTree = useInfraStore((s) => s.setResourceTree);
  const setDeploymentStatus = useInfraStore((s) => s.setDeploymentStatus);

  const setVizControls = useInfraStore((s) => s.setVizControls);

  useEffect(() => {
    // Fetch tree + controls on mount
    fetch("/api/tree")
      .then((r) => r.json())
      .then((data: { tree: ResourceNode | null; status: string }) => {
        if (data.tree) setResourceTree(data.tree);
        setDeploymentStatus(data.status as DeploymentStatus);
      })
      .catch(() => {});

    fetch("/api/viz-controls")
      .then((r) => r.json())
      .then((data: { controls: any[] }) => setVizControls(data.controls))
      .catch(() => {});
  }, [setResourceTree, setDeploymentStatus, setVizControls]);

  if (!resourceTree) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        height: "100vh", fontFamily: "var(--font-mono)", color: "var(--text-muted)", gap: 8,
      }}>
        <div style={{ fontSize: "var(--text-lg)" }}>Waiting for resource tree...</div>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-dim)" }}>
          Run <code style={{ color: "var(--accent)" }}>react-pulumi viz</code> with a TSX file
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateRows: "40px 1fr 32px", gridTemplateColumns: "1fr 340px", height: "100vh" }}>
      {/* ControlPanel — spans full width */}
      <div style={{ gridColumn: "1 / -1" }}>
        <ControlPanel />
      </div>

      {/* Graph area */}
      <div style={{ overflow: "hidden" }}>
        <ResourceGraph />
      </div>

      {/* Right panel — Timeline */}
      <div style={{ borderLeft: "1px solid var(--border)", background: "var(--surface)", overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <Timeline />
      </div>

      {/* Legend bar — spans full width */}
      <div style={{
        gridColumn: "1 / -1", padding: "0 var(--space-lg)",
        borderTop: "1px solid var(--border)", background: "var(--surface)",
        display: "flex", alignItems: "center", gap: "var(--space-lg)",
        fontSize: "var(--text-sm)", color: "var(--text-dim)",
        fontFamily: "var(--font-sans)",
      }}>
        <LegendItem border="1px solid var(--border)" bg="var(--surface)" label="Resource" />
        <LegendItem border="1px dashed var(--accent)" bg="rgba(14,165,233,0.04)" label="Component" />
        <LegendItem border="1px solid var(--accent)" bg="var(--accent-muted)" label="Input" />
        <LegendItem border="1px dashed var(--border)" bg="var(--surface)" label="Button" />
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
          react-pulumi viz
        </span>
      </div>
    </div>
  );
}

function LegendItem({ border, bg, label }: { border: string; bg: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <div style={{ width: 12, height: 8, borderRadius: 2, border, background: bg }} />
      {label}
    </div>
  );
}
