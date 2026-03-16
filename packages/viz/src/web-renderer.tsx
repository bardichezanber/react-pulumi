import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  type Node,
  type Edge,
  Background,
  Controls,
  MiniMap,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useVizStore } from "./store.js";
import type { ResourceNode } from "@react-pulumi/core";
import { ROOT_TYPE } from "@react-pulumi/core";

const COMPONENT_STYLE = {
  background: "#2d2b55",
  color: "#e0e0e0",
  border: "2px dashed #7c6cff",
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 13,
} as const;

const GROUP_STYLE = {
  background: "#1a2744",
  color: "#e0e0e0",
  border: "2px solid #4a9eff",
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 13,
} as const;

const PROVIDER_STYLE = {
  background: "#0d2818",
  color: "#e0e0e0",
  border: "2px solid #2ecc71",
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 13,
} as const;

const ACTION_STYLE = {
  background: "#2a1a00",
  color: "#ffb347",
  border: "2px dashed #e67e22",
  borderRadius: 16,
  fontWeight: 600,
  fontSize: 11,
} as const;

const RESOURCE_STYLE = {
  background: "#ffffff",
  color: "#1a1a2e",
  border: "2px solid #333",
  borderRadius: 4,
  fontSize: 12,
} as const;

function treeToNodesAndEdges(
  root: ResourceNode,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let yOffset = 0;
  const idMap = new WeakMap<ResourceNode, string>();
  let counter = 0;

  function nodeId(node: ResourceNode): string {
    let id = idMap.get(node);
    if (!id) {
      id = `${node.kind}::${node.type}::${node.name}::${counter++}`;
      idMap.set(node, id);
    }
    return id;
  }

  function walk(node: ResourceNode, depth: number): void {
    if (node.type === ROOT_TYPE) {
      for (const child of node.children) {
        walk(child, depth);
      }
      return;
    }

    const id = nodeId(node);
    const { kind } = node;

    const isProvider = "isProvider" in node && node.isProvider;
    let label: string;
    let style: Record<string, unknown>;
    if (kind === "action") {
      const desc = node.meta.description ? `\n${node.meta.description}` : "";
      label = `${node.name}${desc}`;
      style = ACTION_STYLE;
    } else if (kind === "component") {
      label = node.name;
      style = COMPONENT_STYLE;
    } else if (kind === "group") {
      label = `${node.name}\n[${node.meta.componentType ?? node.type}]`;
      style = GROUP_STYLE;
    } else if (isProvider) {
      label = `${node.name}\n(${node.type})`;
      style = PROVIDER_STYLE;
    } else {
      label = `${node.name}\n(${node.type})`;
      style = RESOURCE_STYLE;
    }

    nodes.push({
      id,
      position: { x: depth * 280, y: yOffset * 80 },
      data: { label },
      style,
    });
    yOffset++;

    for (const child of node.children) {
      const childId = nodeId(child);
      edges.push({
        id: `${id}->${childId}`,
        source: id,
        target: childId,
        animated: kind === "component",
        style: isProvider ? { strokeDasharray: "5 5" } : undefined,
      });
      walk(child, depth + 1);
    }
  }

  walk(root, 0);
  return { nodes, edges };
}

export function ResourceGraph() {
  const resourceTree = useVizStore((s) => s.resourceTree);
  const deploymentStatus = useVizStore((s) => s.deploymentStatus);

  const { nodes, edges } = useMemo(() => {
    if (!resourceTree) return { nodes: [], edges: [] };
    return treeToNodesAndEdges(resourceTree);
  }, [resourceTree]);

  const onInit = useCallback(() => {
    console.log("[react-pulumi viz] Graph initialized");
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <div
        style={{
          padding: "12px 16px",
          background: "#1a1a2e",
          color: "#e0e0e0",
          fontFamily: "monospace",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>react-pulumi viz</span>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span
              style={{
                display: "inline-block",
                width: 12,
                height: 12,
                border: "2px dashed #7c6cff",
                borderRadius: 3,
                background: "#2d2b55",
              }}
            />
            Component
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span
              style={{
                display: "inline-block",
                width: 12,
                height: 12,
                border: "2px solid #4a9eff",
                borderRadius: 3,
                background: "#1a2744",
              }}
            />
            Group
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span
              style={{
                display: "inline-block",
                width: 12,
                height: 12,
                border: "2px solid #2ecc71",
                borderRadius: 3,
                background: "#0d2818",
              }}
            />
            Provider
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span
              style={{
                display: "inline-block",
                width: 12,
                height: 12,
                border: "2px solid #333",
                borderRadius: 2,
                background: "#fff",
              }}
            />
            Resource
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span
              style={{
                display: "inline-block",
                width: 12,
                height: 12,
                border: "2px dashed #e67e22",
                borderRadius: 6,
                background: "#2a1a00",
              }}
            />
            Action
          </span>
          <span>Status: {deploymentStatus}</span>
        </div>
      </div>
      <div style={{ width: "100%", height: "calc(100vh - 44px)" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onInit={onInit}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
    </div>
  );
}
