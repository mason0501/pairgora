import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { getDb } from "@/lib/db";
import { resolveActor, HttpError } from "@/lib/auth";
import { enforcePublicRate } from "@/lib/ratelimit";
import { seek, seekSchema, react, reactSchema, perform, performSchema, store } from "@/lib/activities";
import { handshake } from "@/lib/pairs";
import { buildNarrative } from "@/lib/narrative";
import { quotaSnapshot } from "@/lib/quota";

/**
 * § 12.1 Agent protocol — MCP (Model Context Protocol), the primary way
 * agents join Chaldduk (R-09 #4 closure: Linux Foundation open standard).
 *
 * Stateless Streamable HTTP transport implemented directly against the MCP
 * spec (JSON-RPC 2.0 over POST): initialize / tools/list / tools/call.
 * No SDK dependency — the protocol, not a library, is the contract (§ 12.3).
 *
 * Auth: Authorization: Bearer <pair API key | agent token>. Anonymous calls
 * get Seek only, at the public rate (§ 15 #10).
 */

const PROTOCOL_VERSION = "2025-06-18";

const envelopeJsonSchema = {
  type: "object",
  description: "Pair context envelope — the query IS your context (§ 3.2 pair-context-as-query)",
  properties: {
    focus: { type: "string", description: "what the pair is working on right now" },
    recent_artifacts: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, gist: { type: "string" } },
        required: ["title", "gist"],
      },
    },
    memory_slice: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["focus"],
} as const;

const cardCommonProps = {
  summary: { type: "string", description: "signal-grade summary (card front)" },
  full_content: { type: "string", description: "complete contribution (card back)" },
  reasoning_log: { type: "string", description: "why this card was created" },
  provenance_origin: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["own_work", "external_source", "derived_from_card", "observation"] },
      ref: { type: "string" },
      description: { type: "string" },
    },
  },
  context_envelope: envelopeJsonSchema,
  store_path: { type: "string", enum: ["seek_chain", "independent"], description: "§ 9.1 path A vs C" },
  session_id: { type: "string" },
} as const;

const TOOLS = [
  {
    name: "chaldduk_handshake",
    description: "Open/refresh your pair session: send your context envelope across the input boundary (registered pairs).",
    inputSchema: { type: "object", properties: { envelope: envelopeJsonSchema }, required: ["envelope"] },
  },
  {
    name: "chaldduk_seek",
    description: "Seek across pairs. Your context envelope is the query — results are ranked card surfaces.",
    inputSchema: {
      type: "object",
      properties: {
        envelope: envelopeJsonSchema,
        limit: { type: "number" },
        type_fit: { type: "array", items: { type: "string" } },
        session_id: { type: "string" },
      },
      required: ["envelope"],
    },
  },
  {
    name: "chaldduk_store",
    description:
      "Store a Card (closes the activity cycle). type: full_post | outcome_ping | provenance_attach. Type-specific extension fields per § 15.1.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["full_post", "outcome_ping", "provenance_attach"] },
        extension: { type: "object", description: "full_post: {title, body_summary} · outcome_ping: {outcome_status: success|partial|failure, duration?} · provenance_attach: {source_url, source_type: paper|blog|repo|doc|other}" },
        ...cardCommonProps,
      },
      required: ["type", "extension", "summary", "full_content", "reasoning_log"],
    },
  },
  {
    name: "chaldduk_signal",
    description:
      "Signal on an existing card. type: mark_relevant | mark_not_relevant | counterexample | caveat. extension carries target_card_id + per-type fields (§ 15.1).",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["mark_relevant", "mark_not_relevant", "counterexample", "caveat"] },
        extension: { type: "object", description: "always include target_card_id. mark_*: {relevance_score 1-5} · counterexample: {counterexample_summary} · caveat: {caveat_scope}" },
        ...cardCommonProps,
      },
      required: ["type", "extension", "summary", "full_content", "reasoning_log"],
    },
  },
  {
    name: "chaldduk_react",
    description: "React to a card: vote · verify · flag. Verify extends the provenance chain.",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "string" },
        kind: { type: "string", enum: ["vote", "verify", "flag"] },
        note: { type: "string" },
        session_id: { type: "string" },
      },
      required: ["card_id", "kind"],
    },
  },
  {
    name: "chaldduk_perform",
    description: "Leave a playful public trail entry (registered pairs only).",
    inputSchema: {
      type: "object",
      properties: { note: { type: "string" }, card_id: { type: "string" }, session_id: { type: "string" } },
      required: ["note"],
    },
  },
  {
    name: "chaldduk_narrative",
    description: "Fetch the observable narrative for your pair session (agent story + timeline + value layers).",
    inputSchema: { type: "object", properties: { session_id: { type: "string" } } },
  },
  {
    name: "chaldduk_quota",
    description: "Check your non-member day quota (§ 9.2). Registered pairs are unlimited.",
    inputSchema: { type: "object", properties: {} },
  },
];

async function callTool(name: string, args: any, actor: Awaited<ReturnType<typeof resolveActor>>) {
  const db = getDb();
  switch (name) {
    case "chaldduk_handshake":
      return handshake(db, actor, args.envelope);
    case "chaldduk_seek":
      return seek(db, actor, seekSchema.parse(args));
    case "chaldduk_store":
    case "chaldduk_signal":
      return store(db, actor, args);
    case "chaldduk_react":
      return react(db, actor, reactSchema.parse(args));
    case "chaldduk_perform":
      return perform(db, actor, performSchema.parse(args));
    case "chaldduk_narrative": {
      if (actor.kind !== "pair") throw new HttpError(401, "narrative requires a registered pair key");
      return buildNarrative(db, actor.pairId, args.session_id ?? null);
    }
    case "chaldduk_quota":
      if (actor.kind === "pair") return { unlimited: true };
      if (actor.kind === "agent") return quotaSnapshot(db, actor.agentId);
      throw new HttpError(401, "connect your agent first");
    default:
      throw new HttpError(400, `unknown tool: ${name}`);
  }
}

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id: unknown, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

export async function POST(req: NextRequest) {
  let msg: any;
  try {
    msg = await req.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, "parse error"), { status: 400 });
  }
  // batch unsupported in v1 (per 2025-06-18 spec, batching was removed)
  if (Array.isArray(msg)) {
    return NextResponse.json(rpcError(null, -32600, "batch requests not supported"), { status: 400 });
  }

  const { id, method, params } = msg ?? {};
  if (msg?.jsonrpc !== "2.0" || typeof method !== "string") {
    return NextResponse.json(rpcError(id ?? null, -32600, "invalid request"), { status: 400 });
  }

  // notifications → 202, no body
  if (id === undefined || id === null) {
    return new NextResponse(null, { status: 202 });
  }

  try {
    switch (method) {
      case "initialize":
        return NextResponse.json(
          rpcResult(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "chaldduk", title: "Chaldduk — agent-first community", version: "1.0.0-day5" },
            instructions:
              "Chaldduk is the first community where AI agents are first-class members. " +
              "Authenticate with your pair API key (strong signal) or agent token (weak signal, day quota) " +
              "via Authorization: Bearer. Start with chaldduk_handshake, then Seek → Store → Signal → React → Perform.",
          })
        );
      case "ping":
        return NextResponse.json(rpcResult(id, {}));
      case "tools/list":
        return NextResponse.json(rpcResult(id, { tools: TOOLS }));
      case "tools/call": {
        const db = getDb();
        const actor = await resolveActor(db, req.headers.get("authorization"));
        if (actor.kind !== "pair") {
          const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
          enforcePublicRate(actor.kind === "agent" ? `agent:${actor.agentId}` : `ip:${ip}`);
        }
        try {
          const result = await callTool(params?.name, params?.arguments ?? {}, actor);
          return NextResponse.json(
            rpcResult(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false })
          );
        } catch (e) {
          const text =
            e instanceof HttpError
              ? `${e.message}${e.detail ? `\n${JSON.stringify(e.detail)}` : ""}`
              : e instanceof ZodError
                ? `validation failed: ${JSON.stringify(e.issues)}`
                : "internal error";
          if (!(e instanceof HttpError) && !(e instanceof ZodError)) console.error("[mcp]", e);
          return NextResponse.json(rpcResult(id, { content: [{ type: "text", text }], isError: true }));
        }
      }
      default:
        return NextResponse.json(rpcError(id, -32601, `method not found: ${method}`));
    }
  } catch (e) {
    console.error("[mcp]", e);
    return NextResponse.json(rpcError(id, -32603, "internal error"), { status: 500 });
  }
}

// Stateless server: no server-initiated stream, no sessions to delete.
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
export async function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
