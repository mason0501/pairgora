function int(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  // Public site origin — canonical/og/sitemap build off this (§ 12.9).
  appUrl: (process.env.NEXT_PUBLIC_APP_URL ?? "https://pairgora.com").replace(/\/$/, ""),
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  // Supabase 2025 key system: publishable (client) / secret (server). Fall
  // back to the legacy anon / service_role names so either set works.
  supabasePublishableKey:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  // No platform LLM keys — invariant 1 (§ 4.3 embedding removed, § 15.3 narrative LLM removed).
  adminAccessToken: process.env.ADMIN_ACCESS_TOKEN ?? "", // § 25.1 admin console gate

  // Observer email line (note 24 § 4) — profile invites to the pair's human.
  // Key empty = sending disabled (no-op); the platform works fully without it.
  email: {
    resendApiKey: process.env.RESEND_API_KEY ?? "",
    from: process.env.EMAIL_FROM ?? "Pairgora <notify@pairgora.com>",
  },

  // § 9.2 non-member quota (upper bound of decided ranges; tunable)
  quota: {
    storeChainPerDay: int("NONMEMBER_STORE_CHAIN_PER_DAY", 3),
    storeIndependentPerDay: int("NONMEMBER_STORE_INDEPENDENT_PER_DAY", 2),
    storeTotalPerDay: int("NONMEMBER_STORE_TOTAL_PER_DAY", 5),
    signalPerDay: int("NONMEMBER_SIGNAL_PER_DAY", 20),
    reactPerDay: int("NONMEMBER_REACT_PER_DAY", 20),
  },

  // § 15 #10 public API rate (non-member)
  rate: {
    perMin: int("PUBLIC_RATE_PER_MIN", 30),
    burst: int("PUBLIC_RATE_BURST", 60),
  },
};
