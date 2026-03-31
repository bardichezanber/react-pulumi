/**
 * Browser-side WebSocket client hook for React.
 * Auto-reconnects on close. Dispatches events to useInfraStore.
 */

import { useEffect, useRef } from "react";
import type { ServerMessage } from "@react-pulumi/core";
import { useInfraStore } from "./infra-store.js";
import type { DeploymentStatus } from "./types.js";

const RECONNECT_INTERVAL = 2000;

export function useWebSocket(): void {
  const wsRef = useRef<WebSocket | null>(null);

  const setResourceTree = useInfraStore((s) => s.setResourceTree);
  const setDeploymentStatus = useInfraStore((s) => s.setDeploymentStatus);
  const updateResourceStatus = useInfraStore((s) => s.updateResourceStatus);
  const setResourceStatuses = useInfraStore((s) => s.setResourceStatuses);
  const appendTimelineEntry = useInfraStore((s) => s.appendTimelineEntry);
  const appendAction = useInfraStore((s) => s.appendAction);
  const setWsConnected = useInfraStore((s) => s.setWsConnected);
  const setWsReplayDone = useInfraStore((s) => s.setWsReplayDone);

  useEffect(() => {
    let active = true;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      if (!active) return;
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        setWsReplayDone(false);
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as ServerMessage;
          switch (msg.type) {
            case "state_event":
              appendTimelineEntry(msg.event);
              break;
            case "deploy_outcome":
              appendTimelineEntry(msg.event);
              break;
            case "tree_update":
              setResourceTree(msg.tree as never);
              break;
            case "status_update":
              setDeploymentStatus(msg.status as DeploymentStatus);
              break;
            case "action_entry":
              appendAction((msg as any).entry);
              break;
            case "resource_status":
              updateResourceStatus((msg as any).key, (msg as any).status);
              break;
            case "resource_statuses_bulk": {
              const statuses = (msg as any).statuses as Record<string, string>;
              const entries: Record<string, import("./types.js").ResourceStatusEntry> = {};
              for (const [key, status] of Object.entries(statuses)) {
                entries[key] = { key, status: status as any };
              }
              setResourceStatuses(entries);
              break;
            }
            case "replay_complete":
              setWsReplayDone(true);
              break;
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (active) {
          reconnectTimer = setTimeout(connect, RECONNECT_INTERVAL);
        }
      };

      ws.onerror = () => ws.close();
    }

    connect();

    return () => {
      active = false;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [setResourceTree, setDeploymentStatus, updateResourceStatus, setResourceStatuses, appendTimelineEntry, setWsConnected, setWsReplayDone]);
}
