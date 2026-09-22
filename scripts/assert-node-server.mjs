#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const server = join(root, ".output/server/index.mjs");
if (!existsSync(server)) {
  console.error(
    "[apms] node-server build missing: .output/server/index.mjs\n" +
      "NITRO_PRESET must be node-server. Do not ship a Vercel SPA zip.",
  );
  process.exit(1);
}
console.log("[apms] node-server ok:", server);
