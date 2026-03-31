import { useCallback, useEffect, useState } from "react";
import type { VizControlDescriptor } from "@react-pulumi/core";
import { useInfraStore } from "../infra-store.js";

export function VizControls() {
  const vizControls = useInfraStore((s) => s.vizControls);
  const setVizControls = useInfraStore((s) => s.setVizControls);

  useEffect(() => {
    fetch("/api/viz-controls")
      .then((r) => r.json())
      .then((data: { controls: VizControlDescriptor[] }) => setVizControls(data.controls))
      .catch(() => {});
  }, [setVizControls]);

  if (vizControls.length === 0) return null;

  return (
    <div style={{ padding: 12, borderBottom: "1px solid #333", fontSize: 12 }}>
      <h3 style={{ margin: "0 0 8px", fontSize: 14, color: "#ccc" }}>Controls</h3>
      {vizControls.map((ctrl) =>
        ctrl.controlType === "input" ? (
          <VizInputControl key={ctrl.name} control={ctrl} />
        ) : (
          <VizButtonControl key={ctrl.name} control={ctrl} />
        ),
      )}
    </div>
  );
}

function VizInputControl({ control }: { control: VizControlDescriptor }) {
  const [localValue, setLocalValue] = useState(control.value ?? "");

  const handleApply = useCallback(async () => {
    await fetch(`/api/viz-controls/${encodeURIComponent(control.name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: localValue }),
    });
  }, [control.name, localValue]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <label style={{ color: "#aaa", minWidth: 60 }}>{control.label ?? control.name}</label>
      <input
        type={control.inputType ?? "text"}
        value={String(localValue)}
        min={control.min}
        max={control.max}
        step={control.step}
        onChange={(e) => setLocalValue(
          control.inputType === "number" || control.inputType === "range"
            ? Number(e.target.value)
            : e.target.value,
        )}
        style={{ width: 80, padding: "2px 4px", background: "#2a2a3e", color: "#eee", border: "1px solid #555", borderRadius: 3 }}
      />
      <button onClick={handleApply} style={{ fontSize: 11, padding: "2px 6px", cursor: "pointer" }}>Apply</button>
    </div>
  );
}

function VizButtonControl({ control }: { control: VizControlDescriptor }) {
  const [loading, setLoading] = useState(false);

  const handleClick = useCallback(async () => {
    setLoading(true);
    try {
      await fetch(`/api/viz-controls/${encodeURIComponent(control.name)}`, { method: "POST" });
    } finally {
      setLoading(false);
    }
  }, [control.name]);

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      style={{ display: "block", marginBottom: 4, fontSize: 12, padding: "4px 10px", cursor: "pointer" }}
    >
      {control.label ?? control.name}
    </button>
  );
}
