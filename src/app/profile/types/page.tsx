import type { Metadata } from "next";
import { ARCHETYPES, TYPE_LETTER_LEGEND } from "@/lib/archetypes";

export const metadata: Metadata = {
  title: "The 16 pair types",
  description:
    "Every human–agent pair works in a direction, not at a level. Four axes, sixteen types — find the one that ships like you do.",
  alternates: { canonical: "/profile/types" },
};

/**
 * Public archetype gallery (design note 21 § 3.1) — no auth, shareable landing.
 * Four letters, sixteen types; every pole is a direction, never a grade.
 */
export default function ProfileTypesPage() {
  return (
    <div>
      <h1 className="profile-h1" style={{ marginTop: 8 }}>
        The 16 pair types
      </h1>
      <p className="trail-hint" style={{ maxWidth: 700 }}>
        A pair profile reads four things about how a human and an agent actually work together. Each
        one is a direction with two equal poles — there is no better letter, only yours. The four
        letters make the type.
      </p>

      <div className="letter-legend">
        {TYPE_LETTER_LEGEND.map((l) => (
          <div className="ll" key={l.position}>
            <div className="ll-letters">
              <span className="ll-pole">
                <strong>{l.a.letter}</strong> {l.a.label}
              </span>
              <span className="ll-dim">{l.dimension}</span>
              <span className="ll-pole">
                <strong>{l.b.letter}</strong> {l.b.label}
              </span>
            </div>
            <p className="ll-blurb">{l.blurb}</p>
          </div>
        ))}
      </div>

      <div className="type-grid">
        {ARCHETYPES.map((a) => (
          <article className="type-card" key={a.code}>
            <div className="code">{a.code}</div>
            <h3>
              <a
                href={`/profile/types/${a.code.toLowerCase()}`}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                {a.name}
              </a>
            </h3>
            <p>{a.narrative}</p>
            <p style={{ margin: "8px 0 0" }}>
              <a className="notice" href={`/profile/types/${a.code.toLowerCase()}`}>
                read the full type →
              </a>
            </p>
          </article>
        ))}
      </div>

      <section className="types-cta">
        <h2 className="section-title">Which one is your pair?</h2>
        <p className="trail-hint" style={{ margin: "0 0 14px" }}>
          The short form is 24 statements, about 5 minutes. Your agent files its own deep read from
          your real logs — where the two disagree is where it gets interesting.
        </p>
        <a className="nav-cta" href="/profile" style={{ display: "inline-block" }}>
          Take the test →
        </a>
      </section>
    </div>
  );
}
