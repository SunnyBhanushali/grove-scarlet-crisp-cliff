/**
 * APMS is a PM2 Node process. Grok / the platform often inject
 * NITRO_PRESET=vercel — that emits SPA files only (.output/public) and no
 * .output/server. Never honor vercel/netlify/cloudflare here.
 */
export const NODE_SERVER_PRESET = "node-server";

const FORBIDDEN = /^(vercel|netlify|cloudflare|deno|aws|azure|firebase|winterjs)$/i;

export function resolveNitroPreset(env = process.env) {
  const raw = String(env.NITRO_PRESET || NODE_SERVER_PRESET).trim() || NODE_SERVER_PRESET;
  // Grok Publish injects vercel. Honor it so grok.me actually deploys.
  // VPS packs still call scripts/build-app.mjs which forces node-server.
  if (/^vercel$/i.test(raw) || env.VERCEL) return "vercel";
  if (FORBIDDEN.test(raw)) return NODE_SERVER_PRESET;
  return NODE_SERVER_PRESET;
}

