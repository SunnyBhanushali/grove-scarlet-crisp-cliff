/**
 * APMS is a PM2 Node process. Grok / the platform often inject
 * NITRO_PRESET=vercel — that emits SPA files only (.output/public) and no
 * .output/server. Never honor vercel/netlify/cloudflare here.
 */
export const NODE_SERVER_PRESET = "node-server";

const FORBIDDEN = /^(vercel|netlify|cloudflare|deno|aws|azure|firebase|winterjs)$/i;

export function resolveNitroPreset(env = process.env) {
  const raw = String(env.NITRO_PRESET || NODE_SERVER_PRESET).trim() || NODE_SERVER_PRESET;
  // APMS-BUILD-CONTRACT lock: ignore NITRO_PRESET=vercel (Grok injects it).
  if (FORBIDDEN.test(raw)) return NODE_SERVER_PRESET;
  return NODE_SERVER_PRESET;
}

