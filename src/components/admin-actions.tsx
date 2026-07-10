"use client";

const btn = { marginTop: 0, padding: "4px 10px", fontSize: 12 } as const;

async function post(url: string, body: unknown): Promise<any> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    alert(d.error ?? "action failed");
    return null;
  }
  return d;
}

export function AdminCardActions({ card }: { card: { card_id: string; origin: string; hidden: boolean; unsourced: boolean } }) {
  async function act(body: Record<string, unknown>) {
    const d = await post("/api/admin/cards", { card_id: card.card_id, ...body });
    if (d) location.reload();
  }
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
      <select
        defaultValue={card.origin}
        onChange={(e) => act({ action: "retag", origin: e.target.value })}
        style={{ width: "auto", padding: "4px 8px", fontSize: 12 }}
      >
        <option value="live">live</option>
        <option value="reference">reference</option>
        <option value="seed_smoke">seed_smoke</option>
      </select>
      {card.hidden ? (
        <button className="ghost" style={btn} onClick={() => act({ action: "unhide" })}>
          unhide
        </button>
      ) : (
        <button
          className="ghost"
          style={btn}
          onClick={() => act({ action: "hide", reason: prompt("Soft-hide reason?") ?? "" })}
        >
          soft-hide
        </button>
      )}
      {card.unsourced && (
        <button className="ghost" style={btn} onClick={() => act({ action: "unsource_release" })}>
          release unsourced
        </button>
      )}
    </div>
  );
}

export function AdminPairActions({ pair }: { pair: { pair_id: string; suspended: boolean; cards: number } }) {
  async function act(body: Record<string, unknown>) {
    const d = await post("/api/admin/pairs", { pair_id: pair.pair_id, ...body });
    if (d) {
      if (d.api_key) alert("New API key (copy now — shown once):\n\n" + d.api_key);
      location.reload();
    }
  }
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {pair.suspended ? (
        <button className="ghost" style={btn} onClick={() => act({ action: "unrevoke" })}>
          un-revoke
        </button>
      ) : (
        <button className="ghost" style={btn} onClick={() => confirm("Revoke (suspend) this pair?") && act({ action: "revoke" })}>
          revoke
        </button>
      )}
      <button className="ghost" style={btn} onClick={() => confirm("Re-issue API key? Old key stops working.") && act({ action: "reissue" })}>
        reissue key
      </button>
      {pair.cards === 0 && (
        <button className="ghost" style={btn} onClick={() => confirm("Delete this pair? (only pairs with no cards)") && act({ action: "delete" })}>
          delete
        </button>
      )}
    </div>
  );
}
