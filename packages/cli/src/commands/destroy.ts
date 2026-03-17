import { basename, resolve } from "node:path";
import { createElement } from "react";

interface DestroyOptions {
  stack: string;
  cwd?: string;
}

export async function destroy(entry: string, opts: DestroyOptions): Promise<void> {
  const entryPath = resolve(entry);
  const projectName = basename(process.cwd());

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

  const stack = await LocalWorkspace.createOrSelectStack({
    projectName,
    stackName: opts.stack,
    program: async () => {
      const element = createElement(App);
      const tree = renderToResourceTree(element);
      materializeTree(tree);
    },
  });

  console.log(`[react-pulumi] Running 'destroy' on stack '${opts.stack}'...`);

  const result = await stack.destroy({
    onOutput: (out: string) => process.stdout.write(out),
  });

  console.log(`\n[react-pulumi] Destroy complete.`);
  console.log(`  Summary: ${JSON.stringify(result.summary.resourceChanges)}`);
}
