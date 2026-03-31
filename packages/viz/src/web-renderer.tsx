/**
 * React Flow graph renderer — implements DESIGN.md node taxonomy.
 *
 * Node types:
 *   Resource  — solid border, --surface bg, type token + name
 *   Component — dashed accent border, wrapper for children
 *   VizInput  — accent border, inline editable input
 *   VizButton — dashed border, clickable action trigger
 */

import {
  Background,
  Controls,
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from "@xyflow/react";
import { useCallback, useMemo, useState } from "react";
import "@xyflow/react/dist/style.css";
import type { ResourceNode } from "@react-pulumi/core";
import { ROOT_TYPE } from "@react-pulumi/core";
import { useInfraStore } from "./infra-store.js";

// ── Custom Node Components ──

function ResourceNodeComponent({ data }: NodeProps) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
      padding: "6px 12px", minWidth: 200, fontFamily: "var(--font-sans)",
    }}>
      <Handle type="target" position={Position.Top} style={{ background: "var(--border)" }} />
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
        {(data as any).typeToken}
      </div>
      <div style={{ fontSize: "var(--text-base)", fontWeight: 500, color: "var(--text)" }}>
        {(data as any).label}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: "var(--border)" }} />
    </div>
  );
}

function ComponentNodeComponent({ data }: NodeProps) {
  return (
    <div style={{
      background: "rgba(14,165,233,0.04)", border: "1px dashed var(--accent)", borderRadius: "var(--radius-md)",
      padding: "6px 12px", minWidth: 200, fontFamily: "var(--font-sans)",
    }}>
      <Handle type="target" position={Position.Top} style={{ background: "var(--accent)" }} />
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
        {(data as any).typeToken}
      </div>
      <div style={{ fontSize: "var(--text-base)", fontWeight: 500, color: "var(--text)" }}>
        {(data as any).label}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: "var(--accent)" }} />
    </div>
  );
}

function VizInputNodeComponent({ data }: NodeProps) {
  const d = data as any;
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState(String(d.value ?? ""));

  const handleSubmit = useCallback(() => {
    setEditing(false);
    if (d.onSubmit) {
      const parsed = d.inputType === "number" ? Number(localVal) : localVal;
      d.onSubmit(parsed);
    }
  }, [localVal, d]);

  return (
    <div style={{
      background: "linear-gradient(135deg, var(--surface) 0%, rgba(14,165,233,0.06) 100%)",
      border: editing ? "1px solid var(--accent-hover)" : "1px solid var(--accent)",
      borderRadius: "var(--radius-md)", padding: "6px 12px", minWidth: 200,
      fontFamily: "var(--font-sans)", transition: "border-color 0.15s",
    }}>
      <Handle type="target" position={Position.Top} style={{ background: "var(--accent)" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
        <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", flex: 1 }}>{d.label}</span>
        {editing ? (
          <input
            autoFocus
            type={d.inputType ?? "text"}
            value={localVal}
            onChange={(e) => setLocalVal(e.target.value)}
            onBlur={handleSubmit}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            style={{
              fontFamily: "var(--font-mono)", fontSize: "var(--text-base)", color: "var(--text)",
              background: "var(--bg)", border: "1px solid var(--accent)", borderRadius: 3,
              padding: "1px 6px", width: 70, textAlign: "right", outline: "none",
            }}
          />
        ) : (
          <span
            onClick={() => setEditing(true)}
            style={{
              fontFamily: "var(--font-mono)", fontSize: "var(--text-base)", color: "var(--text)",
              background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 3,
              padding: "1px 6px", minWidth: 50, textAlign: "right", cursor: "text",
            }}
          >
            {d.value ?? "—"}
          </span>
        )}
      </div>
      {d.hint && (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-dim)", marginTop: 2, paddingLeft: 14 }}>
          {d.hint}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: "var(--accent)" }} />
    </div>
  );
}

function VizButtonNodeComponent({ data }: NodeProps) {
  const d = data as any;
  const [flash, setFlash] = useState(false);

  const handleClick = useCallback(() => {
    setFlash(true);
    setTimeout(() => setFlash(false), 150);
    if (d.onClick) d.onClick();
  }, [d]);

  return (
    <div
      onClick={handleClick}
      style={{
        background: flash ? "var(--accent-muted)" : "var(--surface)",
        border: "1px dashed var(--border)", borderRadius: "var(--radius-md)",
        padding: "6px 12px", minWidth: 160, fontFamily: "var(--font-sans)",
        cursor: "pointer", transition: "border-color 0.15s, background 0.05s",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--accent)"; (e.currentTarget as HTMLDivElement).style.borderStyle = "solid"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLDivElement).style.borderStyle = "dashed"; }}
    >
      <Handle type="target" position={Position.Top} style={{ background: "var(--border)" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>▶</span>
        <span style={{ fontSize: "var(--text-base)", fontWeight: 500, color: "var(--text)" }}>{d.label}</span>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: "var(--border)" }} />
    </div>
  );
}

const nodeTypes = {
  resource: ResourceNodeComponent,
  component: ComponentNodeComponent,
  vizInput: VizInputNodeComponent,
  vizButton: VizButtonNodeComponent,
};

// ── Tree → React Flow conversion ──

function classifyNode(node: ResourceNode): "resource" | "component" | "vizInput" | "vizButton" {
  // pulumiToComponent wraps all FCs with type "__component__"
  // The actual identity is in the `name` field
  const name = node.name ?? "";
  if (name === "VizInput") return "vizInput";
  if (name === "VizButton") return "vizButton";

  // Real resources have type tokens like "aws:ec2/vpc:Vpc"
  // Component wrappers have children, leaf resources don't
  if (node.children && node.children.length > 0) return "component";
  return "resource";
}

/** Extract type token from node — it's in the name for __component__ nodes */
function getTypeToken(node: ResourceNode): string {
  const type = node.type ?? "";
  if (type === "__component__") {
    // Name contains the actual type token (e.g., "aws:ec2/vpc:Vpc")
    return node.name ?? "";
  }
  return type;
}

function treeToNodesAndEdges(
  root: ResourceNode,
  vizControls: Array<{ name: string; controlType: string; label?: string; value?: unknown; inputType?: string; min?: number; max?: number }>,
  onAction?: () => void,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let yOffset = 0;
  const idMap = new WeakMap<ResourceNode, string>();
  let counter = 0;

  // Sequential matching: VizInput/VizButton nodes appear in render order
  const inputs = vizControls.filter((c) => c.controlType === "input");
  const buttons = vizControls.filter((c) => c.controlType === "button");
  let inputIdx = 0;
  let buttonIdx = 0;

  function nodeId(node: ResourceNode): string {
    let id = idMap.get(node);
    if (!id) {
      id = `${node.kind}::${node.type}::${node.name}::${counter++}`;
      idMap.set(node, id);
    }
    return id;
  }

  function walk(node: ResourceNode, depth: number, parentId?: string): void {
    if (node.type === ROOT_TYPE) {
      for (const child of node.children) walk(child, depth);
      return;
    }

    // Skip HTML host elements (div, span, etc.)
    if (node.kind === "resource" && /^[a-z]/.test(node.type)) {
      for (const child of node.children) walk(child, depth, parentId);
      return;
    }

    const id = nodeId(node);
    const nodeType = classifyNode(node);

    const typeToken = getTypeToken(node);
    const baseData: Record<string, unknown> = {
      label: node.name,
      typeToken,
    };

    if (nodeType === "vizInput") {
      const ctrl = inputs[inputIdx++];
      baseData.label = ctrl?.label ?? ctrl?.name ?? node.name;
      baseData.value = ctrl?.value ?? "—";
      baseData.inputType = ctrl?.inputType ?? "text";
      if (ctrl?.min != null && ctrl?.max != null) {
        baseData.hint = `range: ${ctrl.min}–${ctrl.max}`;
      }
      const ctrlName = ctrl?.name ?? node.name ?? "";
      baseData.onSubmit = (val: unknown) => {
        fetch(`/api/viz-controls/${encodeURIComponent(ctrlName)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: val }),
        }).then(() => { setTimeout(() => onAction?.(), 200); });
      };
    } else if (nodeType === "vizButton") {
      const ctrl = buttons[buttonIdx++];
      baseData.label = ctrl?.label ?? ctrl?.name ?? node.name;
      const ctrlName = ctrl?.name ?? node.name ?? "";
      baseData.onClick = () => {
        fetch(`/api/viz-controls/${encodeURIComponent(ctrlName)}`, { method: "POST" })
          .then(() => { setTimeout(() => onAction?.(), 200); });
      };
    } else {
      // For __component__ nodes: name IS the type token (e.g., "aws:ec2/vpc:Vpc")
      // Extract short name from type token: "aws:ec2/vpc:Vpc" → "Vpc"
      const shortName = typeToken.includes(":") ? typeToken.split(":").pop() ?? typeToken : typeToken;
      baseData.typeToken = typeToken;
      baseData.label = shortName;
    }

    nodes.push({
      id,
      type: nodeType,
      position: { x: depth * 280, y: yOffset * 80 },
      data: baseData,
    });
    yOffset++;

    if (parentId) {
      const isComponent = nodeType === "component";
      edges.push({
        id: `${parentId}->${id}`,
        source: parentId,
        target: id,
        animated: isComponent,
        style: { stroke: isComponent ? "var(--accent)" : "var(--border)", opacity: isComponent ? 0.4 : 1 },
      });
    }

    for (const child of node.children) {
      walk(child, depth + 1, id);
    }
  }

  walk(root, 0);
  return { nodes, edges };
}

// ── Graph Component ──

export function ResourceGraph() {
  const resourceTree = useInfraStore((s) => s.resourceTree);
  const vizControls = useInfraStore((s) => s.vizControls);
  const setVizControls = useInfraStore((s) => s.setVizControls);
  const setResourceTree = useInfraStore((s) => s.setResourceTree);

  // Refresh controls + tree from server
  const refreshAfterAction = useCallback(() => {
    fetch("/api/viz-controls").then((r) => r.json()).then((d: any) => setVizControls(d.controls)).catch(() => {});
    fetch("/api/tree").then((r) => r.json()).then((d: any) => { if (d.tree) setResourceTree(d.tree); }).catch(() => {});
  }, [setVizControls, setResourceTree]);

  const { nodes, edges } = useMemo(() => {
    if (!resourceTree) return { nodes: [], edges: [] };
    return treeToNodesAndEdges(resourceTree, vizControls, refreshAfterAction);
  }, [resourceTree, vizControls, refreshAfterAction]);

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "smoothstep" }}
      >
        <Background color="var(--border)" gap={20} size={1} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
