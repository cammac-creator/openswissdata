import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import { getDb } from './db.js';
import { stripe } from './stripe.js';
import type { DependencyName, DependencyReason, DependencyCheck, DeepHealth } from './deep-health-types.js';

type Probe = (signal: AbortSignal) => Promise<void>;

class MissingConfiguration extends Error {}
function isTimeout(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; type?: unknown; detail?: { code?: unknown } };
  // Le SDK Stripe encapsule le code réseau dans detail ; toute erreur de connexion n’est pas un délai.
  return value.code === 'ETIMEDOUT' || value.code === 'ESOCKETTIMEDOUT' ||
    (value.type === 'StripeConnectionError' && value.detail?.code === 'ETIMEDOUT');
}

/** Résultats bornés et mutualisés par processus ; l’authentification précède toujours cet appel. */
export function createDeepHealthChecker(probes: Record<DependencyName, Probe>, now = Date.now) {
  let cached: DeepHealth | undefined;
  let pending: Promise<DeepHealth> | undefined;
  const ttl = 60_000;
  async function check(probe: Probe): Promise<DependencyCheck> {
    const started = now();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(() => probe(controller.signal)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, 3_000);
        }),
      ]);
      return { ok: true, ms: Math.max(0, now() - started) };
    } catch (error) {
      // Aucun message fournisseur, chemin, clé ou compte dans le diagnostic.
      const reason: DependencyReason = controller.signal.aborted || isTimeout(error) ? 'timeout' : error instanceof MissingConfiguration ? 'not_configured' : 'unavailable';
      return { ok: false, ms: Math.max(0, now() - started), reason };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return function diagnose(): Promise<DeepHealth> {
    const time = now();
    if (cached && time >= cached.checked_at && time < cached.valid_until) return Promise.resolve(cached);
    if (pending) return pending;
    pending = (async () => {
      const [db, r2, stripe] = await Promise.all([check(probes.db), check(probes.r2), check(probes.stripe)]);
      const checkedAt = now();
      cached = {
        status: db.ok && r2.ok && stripe.ok ? 'ok' : 'degraded',
        checked_at: checkedAt,
        valid_until: checkedAt + ttl,
        duration_ms: Math.max(0, checkedAt - time),
        checks: { db, r2, stripe },
      };
      return cached;
    })().finally(() => { pending = undefined; });
    return pending;
  };
}

export const diagnoseDependencies = createDeepHealthChecker({
  db: async () => {
    const row = getDb().prepare('SELECT 1 AS ok FROM datasets LIMIT 1').get() as { ok: number } | undefined;
    if (row?.ok !== 1) throw new Error('db_unavailable');
  },
  r2: async signal => {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const bucket = process.env.R2_BUCKET;
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) throw new MissingConfiguration();
    const client = new S3Client({ region: 'auto', maxAttempts: 1,
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`, credentials: { accessKeyId, secretAccessKey } });
    try { await client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: signal }); }
    finally { client.destroy(); }
  },
  stripe: async () => {
    if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY === 'sk_test_xxx') throw new MissingConfiguration();
    // Lecture seule, délai SDK inférieur au plafond global ; aucune relance automatique.
    await stripe().balance.retrieve({}, { timeout: 2_500, maxNetworkRetries: 0 });
  },
});
