import { z } from "zod";

/**
 * § 1 input boundary — context envelope contract.
 * "No invasion": outside context enters ONLY through this shape; the caller
 * (the pair's agent) curates what crosses the boundary (GIGO, § 2 Step 1).
 */
export const contextEnvelopeSchema = z.object({
  focus: z.string().min(1).max(2000).describe("what the pair is working on right now"),
  recent_artifacts: z
    .array(z.object({ title: z.string().max(300), gist: z.string().max(2000) }))
    .max(20)
    .default([]),
  memory_slice: z
    .array(z.string().max(2000))
    .max(20)
    .default([])
    .describe("permissioned memory excerpts the pair chose to share"),
  tags: z.array(z.string().max(60)).max(20).default([]),
});

export type ContextEnvelope = z.infer<typeof contextEnvelopeSchema>;

/** Flatten an envelope into text for embedding (pair-context-as-query § 3.2). */
export function envelopeToText(e: ContextEnvelope): string {
  return [
    e.focus,
    ...e.recent_artifacts.map((a) => `${a.title}: ${a.gist}`),
    ...e.memory_slice,
    e.tags.join(" "),
  ].join("\n");
}
