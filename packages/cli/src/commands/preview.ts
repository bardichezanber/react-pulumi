import { createElement } from "react";
import { resolveProject } from "../project.js";

interface PreviewOptions {
  stack: string;
}

export async function preview(entry: string, opts: PreviewOptions): Promise<void> {
  const { projectDir, projectName, entryPath } = resolveProject(entry);

  console.log(`[react-pulumi] Loading ${entryPath}...`);

  const mod = await import(entryPath);
  const App = mod.default ?? mod.App;

  if (!App) {
    console.error("Entry file must export a default component or named `App` export.");
    process.exit(1);
  }

  const { LocalWorkspace } = await import("@pulumi/pulumi/automation/index.js");
  const pulumi = await import("@pulumi/pulumi");
  const { renderToResourceTree, materializeTree, setPulumiSDK } = await import(
    "@react-pulumi/core"
  );
  setPulumiSDK(pulumi);

  const stack = await LocalWorkspace.createOrSelectStack(
    {
      projectName,
      stackName: opts.stack,
      program: async () => {
        const element = createElement(App);
        const tree = renderToResourceTree(element);
        materializeTree(tree);
      },
    },
    { workDir: projectDir },
  );

  console.log(`[react-pulumi] Running 'preview' on stack '${opts.stack}'...`);

  const result = await stack.preview({
    onOutput: (out: string) => process.stdout.write(out),
  });

  console.log(`\n[react-pulumi] Preview complete.`);
  console.log(`  Changes: ${JSON.stringify(result.changeSummary)}`);
}
