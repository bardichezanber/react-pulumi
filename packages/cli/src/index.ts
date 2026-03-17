#!/usr/bin/env node
import { register } from "tsx/esm/api";

// Enable importing .tsx/.ts files from user entry points
register();

import { Command } from "commander";
import { destroy } from "./commands/destroy.js";
import { preview } from "./commands/preview.js";
import { up } from "./commands/up.js";
import { viz } from "./commands/viz.js";

const program = new Command();

program
  .name("react-pulumi")
  .description("Deploy infrastructure with React components and Pulumi")
  .version("0.1.0");

program
  .command("up")
  .description("Deploy infrastructure defined in JSX/TSX")
  .argument("<entry>", "Path to the entry TSX file")
  .option("-s, --stack <name>", "Stack name", "dev")
  .option("--cwd <dir>", "Working directory for the Pulumi project")
  .action(up);

program
  .command("preview")
  .description("Preview infrastructure changes")
  .argument("<entry>", "Path to the entry TSX file")
  .option("-s, --stack <name>", "Stack name", "dev")
  .option("--cwd <dir>", "Working directory for the Pulumi project")
  .action(preview);

program
  .command("destroy")
  .description("Destroy deployed infrastructure")
  .argument("<entry>", "Path to the entry TSX file")
  .option("-s, --stack <name>", "Stack name", "dev")
  .option("--cwd <dir>", "Working directory for the Pulumi project")
  .action(destroy);

program
  .command("viz")
  .description("Launch the visualization dashboard")
  .argument("<entry>", "Path to the entry TSX file")
  .option("-p, --port <number>", "Port for the viz server", "3000")
  .action(viz);

program.parse();
