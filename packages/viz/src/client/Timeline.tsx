/**
 * Timeline — Action/State History per DESIGN.md.
 *
 * Persistent history with 4 entry types:
 *   ● action  — VizButton click or VizInput edit
 *   ◆ deploy  — successful pulumi up
 *   ✗ failed  — failed deploy attempt
 *   ○ initial — first render state
 *
 * Supports time-travel preview: clicking an entry re-renders the graph
 * with that entry's historical state.
 */

import { useCallback, useEffect, useState } from "react";
import type { VizHistoryEntry } from "@react-pulumi/core";
import { useInfraStore } from "../infra-store.js";

interface StateDiff {
  key: string;
  before: unknown;
  after: unknown;
  changed: boolean;
}

function computeDiffs(entry: VizHistoryEntry): StateDiff[] {
  if (entry.stateBefore && entry.stateAfter) {
    const allKeys = new Set([...Object.keys(entry.stateBefore), ...Object.keys(entry.stateAfter)]);
    return [...allKeys].map((key) => ({
      key,
      before: entry.stateBefore![key],
      after: entry.stateAfter![key],
      changed: entry.stateBefore![key] !== entry.stateAfter![key],
    }));
  }
  // For initial/deploy entries, show the full state snapshot
  return Object.entries(entry.stateSnapshot).map(([key, value]) => ({
    key,
    before: undefined,
    after: value,
    changed: false,
  }));
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

export function Timeline() {
  const [history, setHistory] = useState<VizHistoryEntry[]>([]);
  const timeTravelEntry = useInfraStore((s) => s.timeTravelEntry);
  const setTimeTravelEntry = useInfraStore((s) => s.setTimeTravelEntry);
  const setTimeTravelTree = useInfraStore((s) => s.setTimeTravelTree);
  const setTimeTravelCodeChanged = useInfraStore((s) => s.setTimeTravelCodeChanged);

  // Fetch persistent history on mount
  useEffect(() => {
    fetch("/api/viz-history")
      .then((r) => r.json())
      .then((data: { entries: VizHistoryEntry[] }) => setHistory(data.entries))
      .catch(() => {});
  }, []);

  // Also refresh after WS action_entry events
  const actions = useInfraStore((s) => s.actions);
  useEffect(() => {
    if (actions.length > 0) {
      fetch("/api/viz-history")
        .then((r) => r.json())
        .then((data: { entries: VizHistoryEntry[] }) => setHistory(data.entries))
        .catch(() => {});
    }
  }, [actions.length]);

  const handleEntryClick = useCallback(async (entry: VizHistoryEntry) => {
    // Toggle off if clicking the same entry
    if (timeTravelEntry?.id === entry.id) {
      setTimeTravelEntry(null);
      setTimeTravelTree(null);
      setTimeTravelCodeChanged(false);
      return;
    }

    // Request time-travel re-render from server
    try {
      const res = await fetch("/api/time-travel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stateSnapshot: entry.stateSnapshot,
          originalTreeHash: entry.treeHash,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setTimeTravelEntry(entry);
      setTimeTravelTree(data.tree);
      setTimeTravelCodeChanged(data.codeChanged);
    } catch {
      // Non-fatal
    }
  }, [timeTravelEntry, setTimeTravelEntry, setTimeTravelTree, setTimeTravelCodeChanged]);

  // Newest first
  const reversed = [...history].reverse();

  // Find the index of the latest deploy entry to split pending vs deployed
  const latestDeployIdx = reversed.findIndex(
    (e) => e.entryType === "deploy" || e.entryType === "deploy_failed",
  );

  return (
    <div style={{ fontFamily: "var(--font-sans)", fontSize: "var(--text-base)", display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{
        padding: "var(--space-md) var(--space-lg) var(--space-sm)",
        fontSize: "var(--text-xs)", fontWeight: 600, textTransform: "uppercase" as const,
        letterSpacing: "0.08em", color: "var(--text-dim)", borderBottom: "1px solid var(--border)",
      }}>
        Action / State History
      </div>

      <div style={{ overflowY: "auto", flex: 1 }}>
        {reversed.length === 0 && (
          <div style={{ padding: "var(--space-xl) var(--space-lg)", color: "var(--text-dim)", fontSize: "var(--text-sm)" }}>
            No actions yet. Edit a VizInput or click a VizButton to see state changes here.
          </div>
        )}

        {reversed.map((entry, i) => {
          const isSelected = timeTravelEntry?.id === entry.id;

          if (entry.entryType === "deploy" || entry.entryType === "deploy_failed") {
            return <DeployMarker key={entry.id} entry={entry} />;
          }

          if (entry.entryType === "initial") {
            return (
              <InitialEntry
                key={entry.id}
                entry={entry}
                isSelected={isSelected}
                onClick={() => handleEntryClick(entry)}
              />
            );
          }

          return (
            <ActionEntry
              key={entry.id}
              entry={entry}
              isSelected={isSelected}
              isPending={latestDeployIdx === -1 || i < latestDeployIdx}
              onClick={() => handleEntryClick(entry)}
            />
          );
        })}
      </div>
    </div>
  );
}

function ActionEntry({ entry, isSelected, isPending, onClick }: {
  entry: VizHistoryEntry;
  isSelected: boolean;
  isPending: boolean;
  onClick: () => void;
}) {
  const diffs = computeDiffs(entry);
  return (
    <div
      onClick={onClick}
      style={{
        padding: "var(--space-sm) var(--space-lg)",
        borderBottom: "1px solid var(--border)",
        borderLeft: isSelected ? "2px solid var(--accent)" : "2px solid transparent",
        background: isSelected ? "var(--accent-muted)" : undefined,
        cursor: "pointer",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--surface-raised)"; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ""; }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ color: "var(--accent)" }}>●</span>
          {entry.trigger}
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-dim)" }}>
          {formatTime(entry.timestamp)}
        </span>
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", marginTop: 3 }}>
        {diffs.map((diff) => (
          <div key={diff.key} style={{ color: diff.changed ? "var(--text)" : "var(--text-dim)" }}>
            {diff.key}: {diff.changed
              ? <>{JSON.stringify(diff.before)} <span style={{ color: "var(--accent)" }}>→</span> {JSON.stringify(diff.after)}</>
              : JSON.stringify(diff.after)
            }
          </div>
        ))}
      </div>
    </div>
  );
}

function DeployMarker({ entry }: { entry: VizHistoryEntry }) {
  const success = entry.entryType === "deploy";
  const color = success ? "var(--success)" : "var(--error)";
  const icon = success ? "◆" : "✗";
  const label = success ? `deployed (${entry.deployId ?? "?"})` : "failed";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "var(--space-xs) var(--space-lg)",
      color,
      fontSize: "var(--text-xs)",
      fontFamily: "var(--font-mono)",
    }}>
      <div style={{ flex: 1, height: 1, background: color, opacity: 0.4 }} />
      <span>{icon} {label}</span>
      <div style={{ flex: 1, height: 1, background: color, opacity: 0.4 }} />
    </div>
  );
}

function InitialEntry({ entry, isSelected, onClick }: {
  entry: VizHistoryEntry;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "var(--space-sm) var(--space-lg)",
        borderLeft: isSelected ? "2px solid var(--accent)" : "2px solid transparent",
        background: isSelected ? "var(--accent-muted)" : undefined,
        cursor: "pointer",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--surface-raised)"; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ""; }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 500, display: "flex", alignItems: "center", gap: 4, color: "var(--text-muted)" }}>
          <span>○</span>
          initial render
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-dim)" }}>
          {formatTime(entry.timestamp)}
        </span>
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", marginTop: 3, color: "var(--text-dim)" }}>
        {Object.entries(entry.stateSnapshot).map(([key, value]) => (
          <div key={key}>{key}: {JSON.stringify(value)}</div>
        ))}
      </div>
    </div>
  );
}
