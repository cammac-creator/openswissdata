import type { DeepHealth } from '../../../src/lib/deep-health-types';

const names = { db: 'Base de données', r2: 'Stockage des fichiers', stripe: 'Connexion à Stripe' };
const reasons = { timeout: 'Délai de réponse dépassé', not_configured: 'Configuration à compléter', unavailable: 'Connexion à vérifier' };

export function serviceHealthPanel(): string {
  return `<section class="panel" style="margin-bottom:24px"><div class="panel-heading"><div><h2>Vérifier les connexions du service</h2><p>Un contrôle à la demande de la base, des fichiers et du paiement.</p></div></div><button class="button" id="check-dependencies" type="button">Lancer le contrôle</button><div id="dependency-result" role="status" aria-live="polite"></div><p class="source-note">Le résultat est conservé une minute. Ce contrôle ne prouve pas qu’une commande a été reçue ou qu’un fichier a été ouvert.</p></section>`;
}

export function renderDependencyResult(value: unknown): string {
  const result = value as DeepHealth | null;
  if (!result || !['ok', 'degraded'].includes(result.status) || !Number.isFinite(result.checked_at) || !result.checks) throw new Error('invalid_diagnostic');
  const rows = (Object.keys(names) as Array<keyof typeof names>).map(name => {
    const check = result.checks[name];
    if (!check || typeof check.ok !== 'boolean') throw new Error('invalid_diagnostic');
    const label = check.ok ? 'Disponible' : (check.reason && Object.hasOwn(reasons, check.reason) ? reasons[check.reason] : 'Connexion à vérifier');
    return `<div class="health-row"><div class="health-icon ${check.ok ? '' : 'amber'}">${check.ok ? '✓' : '!'}</div><div class="health-copy"><strong>${names[name]}</strong><p>${label}</p></div></div>`;
  }).join('');
  const date = new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(result.checked_at);
  return `<p class="fine" style="margin-top:16px">Vérifié le ${date} · heure suisse</p>${rows}`;
}

export function bindServiceHealth(): void {
  const button = document.getElementById('check-dependencies') as HTMLButtonElement | null;
  const output = document.getElementById('dependency-result');
  if (!button || !output) return;
  button.onclick = async () => {
    button.disabled = true;
    output.textContent = 'Vérification en cours…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch('/api/health/deep', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (!output.isConnected) return;
      if ([401, 403].includes(response.status)) {
        output.textContent = 'Votre accès administrateur doit être vérifié. Actualisez le bureau pour vous reconnecter.';
        return;
      }
      if (response.status !== 200 && response.status !== 503) throw new Error('diagnostic_unavailable');
      const result: unknown = await response.json();
      if (output.isConnected) output.innerHTML = renderDependencyResult(result);
    } catch {
      if (output.isConnected) output.textContent = 'Le diagnostic n’a pas pu être obtenu. Aucun état disponible n’est déduit de cet échec.';
    } finally {
      clearTimeout(timeout);
      button.disabled = false;
    }
  };
}
