#!/usr/bin/env node
/**
 * Production build for the VPS. Forces node-server and refuses a SPA-only zip.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NODE_SERVER_PRESET } from "./nitro-preset.mjs";
import { exitStatusFromChild } from "./with-app-env.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const env = {
  ...process.env,
  NITRO_PRESET: NODE_SERVER_PRESET,
};
delete env.VERCEL;
delete env.VERCEL_ENV;
delete env.VERCEL_URL;

const child = spawn(
  process.execPath,
  [join(root, "scripts/with-app-env.mjs"), "vite", "build"],
  { stdio: "inherit", env, cwd: root },
);

child.on("exit", (code, signal) => {
  const status = exitStatusFromChild(code, signal);
  if (status !== 0) process.exit(status);
  const check = spawn(process.execPath, [join(root, "scripts/assert-node-server.mjs")], {
    stdio: "inherit",
    cwd: root,
  });
  check.on("exit", (c, s) => process.exit(exitStatusFromChild(c, s)));
});
