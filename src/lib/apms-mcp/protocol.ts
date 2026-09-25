/**
 * Minimal MCP server over Streamable HTTP (stateless, JSON replies).
 *
 * Spec: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
 * One POST = one JSON-RPC message (or a batch). No sessions, no SSE stream:
 * every tool here is a quick read, so the reply is plain `application/json`.
 * Dependency-free on purpose (the build sandbox cannot add npm packages).
 */
import { TOOLS, runTool, type ToolEnv } from "./tools.ts";

export const SERVER_NAME = "aliens-apms";
export const SERVER_VERSION = "1.0.0";
export const SUPPORTED_PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = [
  "Aliens APMS is Aliens Tattoo's performance-management app: org (brands, SBUs / studios, functions, roles, people),",
  "monthly APMS plans (KPIs, execution outcomes, values → P-score), monthly Rewards plans (targets unlock a milestone",
  "M1–M5; payout = slab × KPI score ÷ 5), Targets, Awards, Roster, MIS and Settings.",
  "Everything is read-only and limited to what the signed-in APMS login can see.",
  "Months are YYYY-MM; the financial year runs April–March. Money is in rupees.",
  "Start with apms_whoami or apms_overview; use apms_search_people to find someone; apms_scorecard for one person-month.",
].join(" ");

type Json = Record<string, unknown>;
type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Json };

export type McpContext = {
  /** Loaded lazily: only tools/call needs the company data. */
  env: () => Promise<ToolEnv>;
  personId: string;
  log?: (line: string) => void;
};

function rpcResult(id: RpcRequest["id"], result: unknown): Json {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: RpcRequest["id"], code: number, message: string): Json {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export function toolList() {
  return TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { title: t.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }));
}

async function handleOne(msg: RpcRequest, ctx: McpContext): Promise<Json | null> {
  if (!msg || typeof msg !== "object" || typeof msg.method !== "string") {
    return rpcError(msg?.id ?? null, -32600, "Invalid request");
  }
  const isNotification = msg.id === undefined || msg.id === null;
  const params = (msg.params && typeof msg.params === "object" ? msg.params : {}) as Json;
  switch (msg.method) {
    case "initialize": {
      const asked = String(params.protocolVersion || "");
      const protocolVersion = SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[1];
      return rpcResult(msg.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, title: "Aliens APMS", version: SERVER_VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return isNotification ? null : rpcResult(msg.id, {});
    case "tools/list":
      return rpcResult(msg.id, { tools: toolList() });
    case "tools/call": {
      const name = String(params.name || "");
      const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
      const started = Date.now();
      const env = await ctx.env();
      const out = await runTool(name, args, env);
      ctx.log?.(`[apms-mcp] ${ctx.personId} ${name} ${JSON.stringify(args).slice(0, 200)} → ${out.isError ? "error" : "ok"} ${out.text.length}b ${Date.now() - started}ms`);
      return rpcResult(msg.id, { content: [{ type: "text", text: out.text }], isError: out.isError });
    }
    case "resources/list":
      return rpcResult(msg.id, { resources: [] });
    case "resources/templates/list":
      return rpcResult(msg.id, { resourceTemplates: [] });
    case "prompts/list":
      return rpcResult(msg.id, { prompts: [] });
    default:
      if (msg.method.startsWith("notifications/")) return null;
      return isNotification ? null : rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

/** Handle one POST body. Returns the JSON reply, or null (202, notifications only). */
export async function handleMcpBody(body: unknown, ctx: McpContext): Promise<unknown | null> {
  if (Array.isArray(body)) {
    if (!body.length) return rpcError(null, -32600, "Empty batch");
    const out: Json[] = [];
    for (const m of body) {
      const r = await handleOne(m as RpcRequest, ctx);
      if (r) out.push(r);
    }
    return out.length ? out : null;
  }
  return handleOne(body as RpcRequest, ctx);
}

export function parseError(): Json {
  return rpcError(null, -32700, "Parse error");
}
