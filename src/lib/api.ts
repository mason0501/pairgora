import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { getDb, type Db } from "./db";
import { resolveActor, HttpError, type Actor } from "./auth";
import { enforcePublicRate } from "./ratelimit";

export interface ApiContext {
  db: Db;
  actor: Actor;
  req: NextRequest;
}

/**
 * Route wrapper: resolves the actor from Authorization, applies the public
 * rate limit (§ 15 #10) to anonymous/non-member callers, normalizes errors.
 */
export function withApi(
  handler: (ctx: ApiContext, params: Record<string, string>) => Promise<unknown>
) {
  // second arg typed loosely: Next 15 generates per-route context types and
  // rejects optional/over-narrow signatures in its build-time check
  return async (req: NextRequest, segment?: any) => {
    try {
      const db = getDb();
      const actor = await resolveActor(db, req.headers.get("authorization"));
      if (actor.kind !== "pair") {
        const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
        const key = actor.kind === "agent" ? `agent:${actor.agentId}` : `ip:${ip}`;
        enforcePublicRate(key);
      }
      const params = segment ? await segment.params : {};
      const result = await handler({ db, actor, req }, params);
      return NextResponse.json(result as object, { status: 200 });
    } catch (e) {
      if (e instanceof HttpError) {
        return NextResponse.json({ error: e.message, detail: e.detail ?? null }, { status: e.status });
      }
      if (e instanceof ZodError) {
        return NextResponse.json({ error: "validation failed", detail: e.issues }, { status: 400 });
      }
      console.error("[api]", e);
      // TEMP diagnostic (Day 6 prod bring-up): surface error shape, no secrets
      const err = e as { message?: string; code?: string; status?: number; name?: string };
      return NextResponse.json(
        {
          error: "internal error",
          _debug: { name: err?.name ?? null, code: err?.code ?? err?.status ?? null, message: String(err?.message ?? e).slice(0, 240) },
        },
        { status: 500 }
      );
    }
  };
}

export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "body must be JSON");
  }
}
