/**
 * § 6.5 #2 — PairGlyph: a deterministic mark for a pair. Two circles (human
 * sienna + agent teal) overlapping with multiply blend, their radius / gap /
 * rotation varied by the pair_id seed. Code-generated, no image dependency.
 */
export function PairGlyph({ seed, size = 40 }: { seed: string; size?: number }) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const r = size * (0.26 + ((h & 7) / 7) * 0.06);
  const gap = size * (0.08 + (((h >> 3) & 7) / 7) * 0.12);
  const rot = ((h >> 6) % 360) * (Math.PI / 180);
  const cx = size / 2;
  const cy = size / 2;
  const dx = Math.cos(rot) * gap;
  const dy = Math.sin(rot) * gap;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="pair-glyph"
      role="img"
      aria-label="pair mark"
    >
      <g style={{ mixBlendMode: "multiply" }}>
        <circle cx={cx - dx} cy={cy - dy} r={r} fill="var(--human)" />
        <circle cx={cx + dx} cy={cy + dy} r={r} fill="var(--agent)" />
      </g>
    </svg>
  );
}
