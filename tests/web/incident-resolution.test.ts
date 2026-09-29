import { describe, expect, it } from 'vitest';
import { renderDeliveryIncidents, renderResolutionHistory } from '../../web/src/lib/delivery-incidents';
import type { DeliveryIncidentPage, DeliveryIncidentRow, IncidentResolution } from '../../src/lib/delivery-incidents';

const now = Date.parse('2026-09-29T12:00:00Z');
const hostile = '<img src=x onerror=alert(1)>\nDeuxième ligne';
const resolution = (change: Partial<IncidentResolution> = {}): IncidentResolution => ({ id: 7, kind: 'provider_delivery_verified', note: 'Remise vérifiée.', resolved_at: now, resolved_by: 1, by_viewer: true, reason: 'delivery_confirmation_required', observations: 1, attempts: 1, delivery_state: 'review', order_state: 'paid', in_force: true, ...change });
function page(change: Partial<DeliveryIncidentRow> = {}, state: DeliveryIncidentPage['state'] = 'open'): DeliveryIncidentPage {
  const row: DeliveryIncidentRow = { id: 1, delivery_id: 1, order_id: 2, customer_id: 3, dataset_id: 'fictif', state: 'open', status: 'open', reason: 'delivery_confirmation_required', first_seen_at: now, last_seen_at: now, last_checked_at: now, closed_at: null, observations: 1, last_attempts: 1, last_delivery_state: 'review', last_order_state: 'paid', accepted_at: null, task: null, resolution: null, resolutions: 0, ...change };
  return { checked_at: now, state, summary: { open: 1, resolved: 2, accepted: 3, cancelled: 4 }, scan: null, retention_days: 180, page: { number: 1, total_pages: 1, total: 1, returned: 1, limit: 20, has_previous: false, has_next: false }, incidents: [row] };
}

describe('Clôture manuelle dans le panneau des incidents', () => {
  it('propose la clôture en deux temps sur un dossier à vérifier, avec les quatre types et une note bornée', () => {
    const html = renderDeliveryIncidents(page());
    expect(html).toContain('data-incident-resolve="1"');
    for (const kind of ['provider_delivery_verified', 'customer_contacted', 'manual_resend', 'no_action']) expect(html).toContain(`value="${kind}"`);
    expect(html).toContain('maxlength="280"');
    expect(html).toMatch(/data-resolve-confirm hidden/);
    expect(html).toContain('Vérifier avant de clore');
    expect(html).toContain('l’application n’envoie rien');
    expect(html).not.toMatch(/<script|onclick=|onsubmit=|style="/);
  });

  it('présente les quatre sélections et leurs totaux', () => {
    const html = renderDeliveryIncidents(page());
    expect(html).toContain('1 à vérifier · 2 clos manuellement · 3 avec envoi accepté · 4 annulé(s) ou suspendu(s)');
    expect(html).toContain('data-incident-state="resolved" aria-pressed="false">Clos manuellement');
  });

  it('affiche un dossier clos avec sa preuve échappée, son auteur et sans formulaire de clôture ou d’action', () => {
    const html = renderDeliveryIncidents(page({ status: 'resolved', resolution: resolution({ note: hostile }), resolutions: 1 }, 'resolved'));
    expect(html).toContain('pill blue">Clos manuellement');
    expect(html).toContain('Situation signalée par le registre : Résultat de l’envoi à vérifier avant toute reprise');
    expect(html).toContain('par vous · Remise vérifiée chez le prestataire');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('data-incident-resolve=');
    expect(html).not.toContain('data-incident-task=');
    expect(html).toContain('une nouvelle observation ou un changement d’état rouvrira ce dossier');
    expect(renderDeliveryIncidents(page({ status: 'resolved', resolution: resolution({ by_viewer: false, resolved_by: 9 }) }, 'resolved'))).toContain('un autre compte administrateur (n° 9)');
  });

  it('déclare qu’un « nouvel envoi manuel » n’a rien fait partir de l’application', () => {
    expect(renderDeliveryIncidents(page({ status: 'resolved', resolution: resolution({ kind: 'manual_resend' }) }, 'resolved'))).toContain('l’application n’a rien envoyé');
  });

  it('signale une clôture remise en question, garde la preuve et propose une nouvelle clôture', () => {
    const observed = renderDeliveryIncidents(page({ observations: 2, resolution: resolution({ in_force: false }), resolutions: 1 }));
    expect(observed).toContain('À revérifier : clos manuellement le');
    expect(observed).toContain('une nouvelle observation a été enregistrée le');
    expect(observed).toContain('data-incident-resolve="1"');
    const refunded = renderDeliveryIncidents(page({ last_order_state: 'refunded', resolution: resolution({ in_force: false }) }));
    expect(refunded).toContain('la commande est passée de « payée » à « remboursée »');
    const delivery = renderDeliveryIncidents(page({ last_delivery_state: 'pending', resolution: resolution({ in_force: false }) }));
    expect(delivery).toContain('la livraison est passée de « à vérifier » à « en attente »');
  });

  it('mentionne une ancienne clôture sur un dossier accepté ensuite, sans formulaire', () => {
    const html = renderDeliveryIncidents(page({ state: 'accepted', status: 'accepted', accepted_at: now, resolution: resolution({ in_force: false }) }, 'accepted'));
    expect(html).toContain('le prestataire a depuis accepté l’envoi');
    expect(html).not.toContain('data-incident-resolve=');
  });

  it('ne propose pas de rouvrir une action terminée d’un dossier clos et rappelle une action encore ouverte', () => {
    const task = { id: 4, customer_id: 3, title: 'Action fictive', due_on: null, done_at: now, created_at: now };
    const closedTask = renderDeliveryIncidents(page({ status: 'resolved', task, resolution: resolution() }, 'resolved'));
    expect(closedTask).not.toContain('data-incident-reopen');
    expect(closedTask).not.toContain('l’incident reste à vérifier');
    const openTask = renderDeliveryIncidents(page({ status: 'resolved', task: { ...task, done_at: null }, resolution: resolution() }, 'resolved'));
    expect(openTask).toContain('cette action reste ouverte jusqu’à ce que vous la terminiez');
  });

  it('liste les clôtures dans l’historique, échappées et avec leur statut', () => {
    const html = renderResolutionHistory([resolution({ id: 8, note: hostile, kind: 'no_action' }), resolution({ in_force: false, kind: 'inconnu' })], 21);
    expect(html).toContain('Clôtures manuelles');
    expect(html).toContain('(2 affichées sur 21)');
    expect(html).toContain('En vigueur');
    expect(html).toContain('Remise en question par une observation');
    expect(html).toContain('Clos manuellement · Clôture manuelle');
    expect(html).not.toContain('<img');
    expect(renderResolutionHistory([])).toBe('');
  });
});
