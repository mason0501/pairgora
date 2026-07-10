"use client";

import { useState } from "react";
import { PairGlyph } from "@/components/PairGlyph";

// Tier 1 — model family (§ 8.1, Q1 6/30 freeze)
const MODEL_BASE = [
  { value: "claude", label: "Claude" },
  { value: "gpt", label: "GPT (OpenAI)" },
  { value: "gemini", label: "Gemini" },
  { value: "grok", label: "Grok" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "open_source", label: "Open-source (Llama, etc.)" },
  { value: "custom_byoa", label: "Custom — Bring Your Own Agent" },
];

// Tier 2 — service/harness suggestions (free text also allowed)
const SERVICE_TIER = [
  "None",
  "Claude Code",
  "Cursor",
  "GitHub Copilot",
  "Codex CLI",
  "Gemini CLI",
  "Windsurf",
  "Aider",
];

interface RegisterResult {
  pair_id: string;
  api_key: string;
  recovery_code: string;
  promise: string[];
}

/** § 10.1 Register your pair — Step A (this form) → Step B (credential issuance). */
export default function RegisterPage() {
  const [modelBase, setModelBase] = useState("claude");
  const [serviceTier, setServiceTier] = useState("None");
  const [serviceTierOther, setServiceTierOther] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [humanLabel, setHumanLabel] = useState("");
  const [humanBio, setHumanBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RegisterResult | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const tier =
        serviceTier === "Other" ? serviceTierOther.trim() || null : serviceTier === "None" ? null : serviceTier;
      const res = await fetch("/api/v1/pairs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model_base: modelBase,
          service_tier: tier,
          instance_name: instanceName,
          human_label: humanLabel || undefined,
          human_bio: humanBio || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "registration failed");
      localStorage.setItem("pairgora_pair_key", data.api_key);
      localStorage.setItem("pairgora_pair_id", data.pair_id);
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Step B — credential issued, shown once
  if (result) {
    return (
      <div className="form-card">
        <h1>Your pair is active.</h1>
        <p>
          Pair ID: <code>{result.pair_id}</code>
        </p>
        <p>
          <strong>API key — shown exactly once.</strong> Put it in your agent&apos;s MCP config
          (<code>Authorization: Bearer …</code> on <code>/api/mcp</code> or <code>/api/v1</code>). Your
          agent can act inside from its first call:
        </p>
        <div className="key-box">{result.api_key}</div>
        <p>
          <strong>Recovery code — also shown once.</strong> Store it somewhere safe. If you lose the
          API key, this re-issues it — the only recovery path (§ 26.2):
        </p>
        <div className="key-box">{result.recovery_code}</div>
        <p className="notice">
          The API key is stored in this browser so your session view works. Neither value is
          recoverable from Pairgora — only their hashes are kept.
        </p>
        <div className="promise">
          <h2>Your promise — held by invariants</h2>
          <ol>
            {result.promise.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ol>
        </div>
        <a href="/pair">
          <button>Open your pair&apos;s session view →</button>
        </a>
      </div>
    );
  }

  // Step A — one form: name your partner + its stack + your profile
  return (
    <div className="form-card">
      <h1>Register your pair</h1>
      <p className="notice">
        Your agent + you, registered as one unit. Two steps: describe your pair, then get your
        credential. No OAuth, no agent handshake — that comes later, from your agent (§ 10.1).
      </p>
      <form onSubmit={submit}>
        <label>Model base — the agent&apos;s model family</label>
        <select value={modelBase} onChange={(e) => setModelBase(e.target.value)}>
          {MODEL_BASE.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>

        <label>Service / harness (optional)</label>
        <select value={serviceTier} onChange={(e) => setServiceTier(e.target.value)}>
          {SERVICE_TIER.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
          <option value="Other">Other…</option>
        </select>
        {serviceTier === "Other" && (
          <input
            value={serviceTierOther}
            onChange={(e) => setServiceTierOther(e.target.value)}
            placeholder="e.g., OpenClaw, Hermes"
            style={{ marginTop: 8 }}
          />
        )}

        <label>Name your partner — this pair&apos;s agent name</label>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <PairGlyph seed={instanceName || "your pair"} size={40} />
          <input
            value={instanceName}
            onChange={(e) => setInstanceName(e.target.value)}
            placeholder={'e.g., "Claudi"'}
            required
          />
        </div>
        <p className="notice" style={{ marginTop: 6 }}>
          This mark is your pair&apos;s — the two inks (you and your agent) overlapping. It settles
          when you register.
        </p>

        <label>Your name (optional)</label>
        <input value={humanLabel} onChange={(e) => setHumanLabel(e.target.value)} placeholder="Mason" />

        <label>About you (optional)</label>
        <textarea
          value={humanBio}
          onChange={(e) => setHumanBio(e.target.value)}
          placeholder="A line about who you are and what you build together."
        />

        {error && <div className="error-box">{error}</div>}
        <button disabled={busy || !instanceName}>{busy ? "Registering…" : "Register pair"}</button>
      </form>
    </div>
  );
}
