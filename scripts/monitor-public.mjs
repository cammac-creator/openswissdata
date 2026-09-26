import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Source publique → bronze éphémère brut borné → résultat minimal publié.
// Aucun accès à une commande, aucun cookie ni secret administrateur.
const BASE = 'https://www.openswissdata.com';
const LIMIT = 32_768;
export const CHECKS = ['ready', 'freshness'];

export function inspectPublicResponse(name, status, data, now = Date.now()) {
  if (name === 'freshness' && status === 503 && data?.status === 'stale') return { ok: false, reason: 'stale' };
  if (status !== 200) return { ok: false, reason: 'http_error' };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'invalid_response' };
  if (name === 'ready') {
    const ok = data.status === 'ready' && data.checks?.database === true && data.checks?.frontend === true && typeof data.revision === 'string' && /^[a-f0-9]{40}$/.test(data.revision);
    return ok ? { ok: true, reason: 'verified', revision: data.revision } : { ok: false, reason: 'not_ready' };
  }
  if (name !== 'freshness') return { ok: false, reason: 'unknown_check' };
  const version = data.finma_version;
  if (typeof version !== 'string' || !/^\d{4}\.\d{2}\.\d{2}$/.test(version) || version.startsWith('0000')) return { ok: false, reason: 'invalid_version' };
  const date = version.replaceAll('.', '-'), timestamp = Date.parse(date + 'T00:00:00Z');
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) return { ok: false, reason: 'invalid_version' };
  const age = (now - timestamp) / 3_600_000;
  const ok = data.status === 'ok' && age >= 0 && age < 72 && typeof data.age_hours === 'number' && Number.isInteger(data.age_hours) && Math.abs(data.age_hours - age) <= 1;
  return ok ? { ok: true, reason: 'verified', version } : { ok: false, reason: 'stale_or_inconsistent' };
}

async function check(name, { fetchImpl, bronzeDir, now, timeoutMs }) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  let raw = Buffer.alloc(0), http = null, complete = false, failure = 'network_error';
  try {
    const response = await fetchImpl(`${BASE}/api/health/${name}`, {
      redirect: 'error', signal: controller.signal,
      headers: { accept: 'application/json', 'cache-control': 'no-cache', 'user-agent': 'OpenSwissData-public-monitor/1' },
    });
    http = response.status;
    const reader = response.body?.getReader();
    if (!reader) throw new Error('empty');
    while (true) {
      const { value, done } = await reader.read();
      if (done) { complete = true; break; }
      if (raw.length + value.byteLength > LIMIT) {
        raw = Buffer.concat([raw, Buffer.from(value).subarray(0, LIMIT - raw.length)]);
        failure = 'body_too_large'; controller.abort(); await reader.cancel(); break;
      }
      raw = Buffer.concat([raw, Buffer.from(value)]);
    }
  } catch { if (failure !== 'body_too_large') failure = controller.signal.aborted ? 'timeout' : 'network_error'; }
  finally { clearTimeout(timer); }
  // Même une réponse illisible ou tronquée est gardée avant toute interprétation.
  const sha = createHash('sha256').update(raw).digest('hex');
  try {
    await mkdir(bronzeDir, { recursive: true, mode: 0o700 });
    await writeFile(join(bronzeDir, `${name}-${sha}.bin`), raw, { flag: 'wx', mode: 0o600 });
    await writeFile(join(bronzeDir, `${name}.json`), JSON.stringify({ http, complete, bytes: raw.length, sha256: sha }), { flag: 'wx', mode: 0o600 });
  } catch { return { name, http, ok: false, reason: 'bronze_error' }; }
  const witness = { name, http, response_sha256: sha, bytes: raw.length, complete };
  if (!complete) return { ...witness, ok: false, reason: failure };
  try { return { ...witness, ...inspectPublicResponse(name, http, JSON.parse(raw.toString('utf8')), now()) }; }
  catch { return { ...witness, ok: false, reason: http === 200 ? 'invalid_json' : 'http_error' }; }
}

export async function runPublicMonitor({ bronzeDir, fetchImpl = fetch, now = Date.now, timeoutMs = 15_000 }) {
  if (!bronzeDir) throw new Error('Dossier bronze requis');
  const checks = await Promise.all(CHECKS.map(name => check(name, { fetchImpl, bronzeDir, now, timeoutMs })));
  return { checked_at: new Date(now()).toISOString(), ok: checks.every(c => c.ok), checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await runPublicMonitor({ bronzeDir: process.env.MONITOR_BRONZE_DIR });
    console.log(JSON.stringify(report));
    if (process.env.GITHUB_STEP_SUMMARY) {
      await writeFile(process.env.GITHUB_STEP_SUMMARY, `## Contrôle public extérieur\n\nLecture : ${report.checked_at}\n\n${report.checks.map(c => `- ${c.name} : ${c.ok ? 'vérifié' : 'à vérifier'} · HTTP ${c.http ?? 'absent'} · ${c.reason}${c.revision ? ' · révision ' + c.revision : ''}${c.version ? ' · édition ' + c.version : ''}`).join('\n')}\n\nContrôle ponctuel de disponibilité et fraîcheur FINMA. Ne prouve ni achat, ni réception de mail, ni cadence future.\n`, { flag: 'a' });
    }
    process.exitCode = report.ok ? 0 : 1;
  } catch { console.error('Contrôle extérieur non vérifié.'); process.exitCode = 1; }
}
