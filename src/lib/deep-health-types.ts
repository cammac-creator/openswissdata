export type DependencyName = 'db' | 'r2' | 'stripe';
export type DependencyReason = 'timeout' | 'not_configured' | 'unavailable';
export type DependencyCheck = { ok: boolean; ms: number; reason?: DependencyReason };
export type DeepHealth = {
  status: 'ok' | 'degraded';
  checked_at: number;
  valid_until: number;
  duration_ms: number;
  checks: Record<DependencyName, DependencyCheck>;
};
