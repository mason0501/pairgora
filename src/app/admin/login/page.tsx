"use client";

import { useState } from "react";

export default function AdminLogin() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) throw new Error("Invalid token.");
      window.location.href = "/admin";
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form-card" style={{ marginTop: 40 }}>
      <h1>Admin</h1>
      <p className="notice">Operator access only.</p>
      <form onSubmit={submit}>
        <label>Access token</label>
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoFocus />
        {error && <div className="error-box">{error}</div>}
        <button disabled={busy || !token}>{busy ? "…" : "Enter"}</button>
      </form>
    </div>
  );
}
