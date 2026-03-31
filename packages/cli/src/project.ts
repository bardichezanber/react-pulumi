import { basename, dirname, resolve } from "node:path";

export interface ProjectInfo {
  /** Entry file's directory = project root (where Pulumi.yaml lives) */
  projectDir: string;
  /** Directory name as fallback project name (Pulumi.yaml overrides this) */
  projectName: string;
  /** Absolute path to the entry file */
  entryPath: string;
}

/**
 * Resolve project root from entry file path.
 * Project root = directory containing the entry file.
 */
export function resolveProject(entry: string): ProjectInfo {
  const entryPath = resolve(entry);
  const projectDir = dirname(entryPath);
  const projectName = basename(projectDir);
  return { projectDir, projectName, entryPath };
}
