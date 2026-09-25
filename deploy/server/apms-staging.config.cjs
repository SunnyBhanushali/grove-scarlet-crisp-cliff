/* eslint-disable @typescript-eslint/no-require-imports -- PM2 loads this file as CommonJS */
/**
 * PM2 app for STAGING (staging.apms.alienstattoo.in). Used by apms-deploy.sh:
 *   pm2 startOrRestart ~/apms-deploy/bin/apms-staging.config.cjs --update-env
 *
 * Secrets live in ~/apms-deploy/shared/staging.env (chmod 600, never in git).
 * Loading this file THROWS — so PM2 starts nothing — when that env would let
 * staging reach anything but its own database or send mail.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = process.env.APMS_DEPLOY_ROOT || path.join(os.homedir(), "apms-deploy");
const ENV_FILE = path.join(ROOT, "shared", "staging.env");
const STAGE_DB = process.env.STAGE_DB_NAME || "aliens_apms_stage2";
const PORT = String(process.env.STAGING_PORT || "3013");

function readEnvFile(file) {
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    out[line.slice(0, eq).trim()] = v;
  }
  return out;
}

const fileEnv = readEnvFile(ENV_FILE);
const dbUrl = fileEnv.DATABASE_URL || "";
let dbName = "";
try {
  dbName = decodeURIComponent(new URL(dbUrl).pathname.replace(/^\//, ""));
} catch {
  /* checked below */
}
if (dbName !== STAGE_DB) {
  throw new Error(
    `[apms-staging] DATABASE_URL in ${ENV_FILE} must point at ${STAGE_DB} (got "${dbName}"). Refusing to start.`,
  );
}
if (fileEnv.SMTP_PASS) {
  throw new Error(
    `[apms-staging] ${ENV_FILE} sets SMTP_PASS. Staging must never send mail. Refusing to start.`,
  );
}

module.exports = {
  apps: [
    {
      name: process.env.STAGING_PM2 || "apms-staging",
      cwd: path.join(ROOT, "staging", "current"),
      script: ".output/server/index.mjs",
      interpreter: "node",
      node_args: ["--max-old-space-size=1024"],
      exec_mode: "fork",
      instances: 1,
      max_memory_restart: "1200M",
      autorestart: true,
      env: {
        VITE_AUTH_ENABLED: "true",
        ...fileEnv,
        // Fixed for staging — staging.env cannot override these.
        NODE_ENV: "production",
        NITRO_PRESET: "node-server",
        PORT,
        NITRO_PORT: PORT,
        HOST: "127.0.0.1",
        NITRO_HOST: "127.0.0.1",
        BETTER_AUTH_URL: fileEnv.BETTER_AUTH_URL || "https://staging.apms.alienstattoo.in",
        // No mail from staging, even if the PM2 daemon's shell has SMTP_* set.
        SMTP_PASS: "",
        SMTP_USER: "",
        SMTP_HOST: "",
        // 0000 never signs anyone in on staging; everyone uses the staging password.
        APMS_DEFAULT_PIN: "off",
        APMS_STAGING: "1",
      },
    },
  ],
};
