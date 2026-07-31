import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ARCHETYPES, TYPE_LETTER_LEGEND, archetypeOf } from "@/lib/archetypes";

/**
 * One pair type, in full (note 25 § 1) — the shareable MBTI-style result page:
 * the expanded read, thrives/frays, one workflow prescription, and the duo
 * pattern analogues. Static and public; the CTA funnels into /profile.
 */

export const dynamicParams = false;

export function generateStaticParams() {
  return ARCHETYPES.map((a) => ({ code: a.code.toLowerCase() }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const a = archetypeOf(code);
  if (!a) return {};
  return {
    title: `${a.code} — ${a.name}`,
    description: a.narrative,
    alternates: { canonical: `/profile/types/${a.code.toLowerCase()}` },
  };
}

export default async function TypePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const a = archetypeOf(code);
  if (!a) notFound();

  const letters = a.code.split("-");

  return (
    <div style={{ maxWidth: 720 }}>
      <p className="notice" style={{ marginTop: 8 }}>
        <a href="/profile/types">← all 16 pair types</a>
      </p>

      <div className="type-hero" style={{ marginTop: 12 }}>
        <div>
          <span className="type-code">{a.code}</span>
          <span className="type-name"> {a.name}</span>
        </div>
        <p className="type-narrative">{a.narrative}</p>
      </div>

      <section className="panel" style={{ marginTop: 20 }}>
        <h2>Reads as</h2>
        <p className="trail-hint" style={{ margin: 0 }}>
          {a.reads}
        </p>
        <div className="letter-legend" style={{ marginTop: 16 }}>
          {TYPE_LETTER_LEGEND.map((l, i) => {
            const chosen = letters[i];
            const pole = chosen === l.a.letter ? l.a : l.b;
            return (
              <div className="ll" key={l.position}>
                <div className="ll-letters">
                  <span className="ll-pole">
                    <strong>{pole.letter}</strong> {pole.label}
                  </span>
                  <span className="ll-dim">{l.dimension}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel" style={{ marginTop: 20 }}>
        <h2>Thrives when</h2>
        <ul className="trail-hint" style={{ margin: "0 0 14px", paddingLeft: 20 }}>
          {a.thrives.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <h2>Frays when</h2>
        <ul className="trail-hint" style={{ margin: "0 0 14px", paddingLeft: 20 }}>
          {a.frays.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <h2>Try this</h2>
        <p className="trail-hint" style={{ margin: 0 }}>
          {a.try_this}
        </p>
      </section>

      <section className="panel" style={{ marginTop: 20 }}>
        <h2>Famous duos that run like this</h2>
        <p className="notice" style={{ margin: "0 0 12px" }}>
          Pattern analogues — affectionate guesses, not assessments.
        </p>
        {a.duos.map((d) => (
          <p className="trail-hint" style={{ margin: "0 0 8px" }} key={d.duo}>
            <strong>{d.duo}</strong> — {d.why}
          </p>
        ))}
      </section>

      <section className="types-cta" style={{ marginTop: 24 }}>
        <h2 className="section-title">Is this your pair?</h2>
        <p className="trail-hint" style={{ margin: "0 0 14px" }}>
          The short form is 24 statements, about 5 minutes. Your agent files its own deep read from
          your real logs — where the two disagree is where it gets interesting.
        </p>
        <a className="nav-cta" href="/profile" style={{ display: "inline-block" }}>
          Take the short form
        </a>
      </section>
    </div>
  );
}
