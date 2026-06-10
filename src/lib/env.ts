function int(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  openaiKey: process.env.OPENAI_API_KEY ?? "",
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",

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
