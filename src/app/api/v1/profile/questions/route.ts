import { z } from "zod";
import { withApi } from "@/lib/api";
import { listProfileQuestions, PROFILE_FORMS } from "@/lib/profile-store";

const formParam = z.enum(PROFILE_FORMS).optional();

/**
 * Pair Profile question catalog (design note 21) — ?form=deep|short filters
 * to one instrument (deep = agent binary form, short = human likert5 form).
 */
export const GET = withApi(async ({ db, req }) => {
  const form = formParam.parse(req.nextUrl.searchParams.get("form") ?? undefined);
  return { questions: await listProfileQuestions(db, form) };
});
