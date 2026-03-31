/**
 * ControlPanel — top bar per DESIGN.md spec.
 * 40px height, --surface bg, WS indicator + status + Deploy/Preview buttons.
 *
 * Deploy flow: preview first → show dialog → confirm → deploy → show results.
 * Preview flow: preview → show dialog (no deploy button).
 */

import { useCallback, useState } from "react";
import { useInfraStore } from "../infra-store.js";
import { PreviewDialog, type PreviewResult } from "./PreviewDialog.js";

type DialogMode = "preview" | "deploy-confirm" | "deploying" | "deploy-result";

export function ControlPanel() {
  const status = useInfraStore((s) => s.deploymentStatus);
  const wsConnected = useInfraStore((s) => s.wsConnected);
  const actions = useInfraStore((s) => s.actions);
  const timeTravelEntry = useInfraStore((s) => s.timeTravelEntry);
  const timeTravelCodeChanged = useInfraStore((s) => s.timeTravelCodeChanged);
  const setTimeTravelEntry = useInfraStore((s) => s.setTimeTravelEntry);
  const setTimeTravelTree = useInfraStore((s) => s.setTimeTravelTree);
  const setTimeTravelCodeChanged = useInfraStore((s) => s.setTimeTravelCodeChanged);
  const [error, setError] = useState<string | null>(null);
  const [successFlash, setSuccessFlash] = useState(false);
  const [dialogResult, setDialogResult] = useState<PreviewResult | null>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>("preview");

  const isOperating = status === "deploying" || status === "previewing";

  // Count state keys that differ from the initial state
  let pendingCount = 0;
  if (actions.length > 0) {
    const initial = actions[0].stateBefore;
    const current = actions[actions.length - 1].stateAfter;
    const allKeys = new Set([...Object.keys(initial), ...Object.keys(current)]);
    for (const k of allKeys) {
      if (initial[k] !== current[k]) pendingCount++;
    }
  }

  // Preview only — show dialog without deploy option
  const handlePreview = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/preview", { method: "POST" });
    if (res.status === 409) {
      setError("Operation in progress");
      return;
    }
    if (!res.ok) {
      setError(`Preview failed: ${res.statusText}`);
      return;
    }
    try {
      const data = await res.json();
      setDialogResult(data.result ?? {});
      setDialogMode("preview");
    } catch {
      setError("Preview complete");
    }
  }, []);

  // Deploy — first run preview to show what will change, then confirm
  const handleDeploy = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/preview", { method: "POST" });
    if (res.status === 409) {
      setError("Operation in progress");
      return;
    }
    if (!res.ok) {
      setError(`Preview failed: ${res.statusText}`);
      return;
    }
    try {
      const data = await res.json();
      setDialogResult(data.result ?? {});
      setDialogMode("deploy-confirm");
    } catch {
      setError("Preview failed");
    }
  }, []);

  // Confirm deploy — run actual pulumi up
  const handleConfirmDeploy = useCallback(async () => {
    setDialogMode("deploying");
    setError(null);
    try {
      const res = await fetch("/api/deploy", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        setError(`Deploy failed: ${data.error}`);
        setDialogResult(null);
        return;
      }
      const data = await res.json();
      setDialogResult(data.result ?? {});
      setDialogMode("deploy-result");
      setSuccessFlash(true);
      setTimeout(() => setSuccessFlash(false), 5000);
    } catch (err) {
      setError(`Deploy failed: ${err}`);
      setDialogResult(null);
    }
  }, []);

  const closeDialog = useCallback(() => {
    setDialogResult(null);
  }, []);

  const exitTimeTravel = useCallback(() => {
    setTimeTravelEntry(null);
    setTimeTravelTree(null);
    setTimeTravelCodeChanged(false);
  }, [setTimeTravelEntry, setTimeTravelTree, setTimeTravelCodeChanged]);

  const handleRollback = useCallback(async () => {
    if (!timeTravelEntry) return;
    const snap = timeTravelEntry.stateSnapshot;
    const keys = Object.keys(snap);
    const values = Object.values(snap);
    exitTimeTravel();
    setError(null);
    try {
      const res = await fetch("/api/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stateSnapshot: { keys, values } }),
      });
      if (!res.ok) {
        setError("Rollback failed");
      }
    } catch {
      setError("Rollback failed");
    }
  }, [timeTravelEntry, exitTimeTravel]);

  return (
    <div
      style={{
        height: 40,
        padding: "0 var(--space-lg)",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-md)",
        background: "var(--surface)",
        fontFamily: "var(--font-sans)",
      }}
    >
      {/* WS indicator */}
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: wsConnected ? "var(--success)" : "var(--error)",
          boxShadow: wsConnected ? "0 0 6px var(--success)" : "0 0 6px var(--error)",
        }}
      />
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-sm)",
          color: "var(--text-muted)",
        }}
      >
        {wsConnected ? "Connected" : "Reconnecting..."}
      </span>

      {/* Deploy button — runs preview first, then shows confirm dialog */}
      <button
        type="button"
        onClick={handleDeploy}
        disabled={isOperating}
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-sm)",
          fontWeight: 600,
          padding: "4px 12px",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--accent)",
          background: "var(--accent)",
          color: "#000",
          cursor: isOperating ? "not-allowed" : "pointer",
          opacity: isOperating ? 0.5 : 1,
        }}
      >
        {isOperating
          ? "Deploying..."
          : pendingCount > 0
            ? `Deploy (${pendingCount} ${pendingCount === 1 ? "change" : "changes"})`
            : "Deploy"}
      </button>

      {/* Preview button — preview only, no deploy option */}
      <button
        type="button"
        onClick={handlePreview}
        disabled={isOperating}
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-sm)",
          fontWeight: 500,
          padding: "4px 12px",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
          background: "var(--surface-raised)",
          color: "var(--text)",
          cursor: isOperating ? "not-allowed" : "pointer",
          opacity: isOperating ? 0.5 : 1,
        }}
      >
        Preview
      </button>

      {/* Time-travel banner */}
      {timeTravelEntry && (
        <>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-sm)",
              color: "var(--info)",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            Previewing state from {new Date(timeTravelEntry.timestamp).toLocaleTimeString()}
          </span>
          {timeTravelCodeChanged && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-xs)",
                color: "var(--warning)",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              ⚠ Code changed — tree may differ from original
            </span>
          )}
          <button
            type="button"
            onClick={handleRollback}
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              padding: "4px 12px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--warning)",
              background: "transparent",
              color: "var(--warning)",
              cursor: "pointer",
            }}
          >
            Rollback to this
          </button>
          <button
            type="button"
            onClick={exitTimeTravel}
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              padding: "4px 12px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: "var(--surface-raised)",
              color: "var(--text)",
              cursor: "pointer",
            }}
          >
            Back to current
          </button>
        </>
      )}

      {/* Status */}
      <span
        style={{
          marginLeft: "auto",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-sm)",
          color: successFlash ? "var(--success)" : error ? "var(--accent)" : "var(--text-dim)",
          transition: "color 0.15s",
        }}
      >
        {successFlash ? "Deployed ✓" : error ? error : `status: ${status}`}
      </span>

      {/* Preview/Deploy dialog */}
      {dialogResult && (
        <PreviewDialog
          result={dialogResult}
          mode={dialogMode}
          onClose={closeDialog}
          onDeploy={dialogMode === "deploy-confirm" ? handleConfirmDeploy : undefined}
        />
      )}
    </div>
  );
}
