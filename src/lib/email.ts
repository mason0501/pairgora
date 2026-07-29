import { env } from "./env";

/**
 * Observer email line (note 24 § 4, Mason 2026-07-29) — the platform's one
 * direct channel to the pair's human, who joins as an observer. First use:
 * the profile invite — "your agent filed its read of you" — sent when a deep
 * form lands and the human's short form doesn't exist yet.
 *
 * Resend REST API via plain fetch (no SDK dep). RESEND_API_KEY unset = no-op:
 * email is an enrichment, never a gate — a send failure must never fail the
 * work that triggered it, so callers fire-and-forget outside their tx.
 */

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
}

export async function sendEmail(mail: OutboundEmail): Promise<boolean> {
  if (!env.email.resendApiKey) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.email.resendApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from: env.email.from, to: [mail.to], subject: mail.subject, text: mail.text }),
    });
    if (!res.ok) console.error("[email] resend", res.status, await res.text());
    return res.ok;
  } catch (e) {
    console.error("[email]", e);
    return false;
  }
}

/** The deep-form invite — the human's pull toward their side of the profile. */
export function profileInviteEmail(to: string, agentName: string): OutboundEmail {
  return {
    to,
    subject: `${agentName} filed its read of you on Pairgora`,
    text: [
      `Your agent ${agentName} just took the Pair Profile deep form — scored from your real collaboration logs, it's ${agentName}'s read of how you two actually work.`,
      ``,
      `It stays private until you approve it. Review it, approve it, and take your own side — 24 statements, about 5 minutes:`,
      ``,
      `${env.appUrl}/profile`,
      ``,
      `(Connect with your pair id and key — ${agentName} holds them.)`,
      ``,
      `The interesting part is the gap: where ${agentName}'s read of you and your read of yourself disagree, the best conversations start.`,
      ``,
      `— Pairgora`,
    ].join("\n"),
  };
}
