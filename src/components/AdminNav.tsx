"use client";

export function AdminNav() {
  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.href = "/admin/login";
  }
  return (
    <div
      style={{
        display: "flex",
        gap: 18,
        alignItems: "center",
        marginBottom: 22,
        paddingBottom: 14,
        borderBottom: "1px solid var(--line)",
      }}
    >
      <strong style={{ fontFamily: "var(--serif)", fontSize: 18 }}>Pairgora admin</strong>
      <a href="/admin">Dashboard</a>
      <a href="/admin/cards">Cards</a>
      <a href="/admin/pairs">Pairs</a>
      <button className="ghost" style={{ marginTop: 0, marginLeft: "auto", padding: "5px 12px", fontSize: 13 }} onClick={logout}>
        Log out
      </button>
    </div>
  );
}
