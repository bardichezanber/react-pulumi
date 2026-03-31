/**
 * Persistent viz history store — file-based append-only log.
 * Stores VizHistoryEntry objects to .react-pulumi/viz-history.json.
 * Supports computing tree hashes for code change detection.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ResourceNode, VizHistoryEntry } from "@react-pulumi/core";

const HISTORY_FILE = "viz-history.json";
const DIR_NAME = ".react-pulumi";

interface VizHistoryFile {
  version: 1;
  entries: VizHistoryEntry[];
}

export class VizHistoryStore {
  private entries: VizHistoryEntry[] = [];
  private filePath: string;

  constructor(projectDir?: string) {
    const dir = join(projectDir ?? process.cwd(), DIR_NAME);
    this.filePath = join(dir, HISTORY_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  load(): VizHistoryEntry[] {
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const data: VizHistoryFile = JSON.parse(raw);
      if (data.version === 1 && Array.isArray(data.entries)) {
        this.entries = data.entries;
      }
    } catch {
      this.entries = [];
    }
    return this.entries;
  }

  append(entry: VizHistoryEntry): void {
    this.entries.push(entry);
    this.flush();
  }

  getAll(): VizHistoryEntry[] {
    return this.entries;
  }

  private flush(): void {
    const data: VizHistoryFile = { version: 1, entries: this.entries };
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }
}

/** Strip circular parent refs for JSON serialization */
function treeReplacer(key: string, value: unknown): unknown {
  if (key === "parent") return undefined;
  return value;
}

/** Compute SHA-256 hash of a serialized resource tree (parent refs stripped). */
export function computeTreeHash(tree: ResourceNode): string {
  const serialized = JSON.stringify(tree, treeReplacer);
  return createHash("sha256").update(serialized).digest("hex");
}
