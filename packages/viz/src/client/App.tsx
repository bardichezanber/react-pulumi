import { useEffect } from "react";
import { ResourceGraph } from "../web-renderer.js";
import { useVizStore } from "../store.js";
import type { ResourceNode } from "@react-pulumi/core";

export function App() {
  const setResourceTree = useVizStore((s) => s.setResourceTree);
  const setDeploymentStatus = useVizStore((s) => s.setDeploymentStatus);
  const resourceTree = useVizStore((s) => s.resourceTree);

  useEffect(() => {
    let active = true;

    async function fetchTree() {
      try {
        const res = await fetch("/api/tree");
        if (!res.ok) return;
        const data = (await res.json()) as {
          tree: ResourceNode | null;
          status: string;
        };
        if (!active) return;
        if (data.tree) setResourceTree(data.tree);
        setDeploymentStatus(data.status as ReturnType<typeof useVizStore.getState>["deploymentStatus"]);
      } catch {
        // server not ready yet, retry
      }
    }

    fetchTree();
    const interval = setInterval(fetchTree, 2000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [setResourceTree, setDeploymentStatus]);

  if (!resourceTree) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          fontFamily: "monospace",
          color: "#888",
        }}
      >
        Waiting for resource tree...
      </div>
    );
  }

  return <ResourceGraph />;
}
