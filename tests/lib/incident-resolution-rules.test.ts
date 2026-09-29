import { describe, expect, it } from 'vitest';
import { normalizeResolutionNote, resolutionNoteProblem, isResolutionKind, RESOLUTION_KINDS, RESOLUTION_NOTE_MAX } from '../../src/lib/incident-resolution-rules.js';

const check = (text: string) => resolutionNoteProblem(normalizeResolutionNote(text));
describe('Note de preuve d’une clôture manuelle', () => {
  it.each([
    'Remise confirmée dans le journal du prestataire le 29.09 à 14 h 05.',
    'Client joint par téléphone : fichier bien reçu, rien à renvoyer.',
    'Commande de test interne, sans suite.',
    'Fichier transmis à la main depuis contact@ le 29.09 ; réception confirmée.',
    'Vérifié sur resend.com, statut « delivered ».',
    'Zustellung beim Anbieter überprüft, Kunde informiert. Nichtzustellbarkeitsbenachrichtigung erhalten.',
    'Commande 12, tentative 3, remboursement du 2026-09-29-2026-09-30 sans effet.',
    'Deux lignes :\nremise vérifiée,\nclient prévenu.',
    'Émoji accepté ✅ et guillemets « ».',
    'x'.repeat(RESOLUTION_NOTE_MAX),
  ])('admet une note factuelle : %s', text => expect(check(text)).toBeNull());

  it.each([
    ['', 'empty'], ['   \n\t ', 'empty'],
    ['x'.repeat(RESOLUTION_NOTE_MAX + 1), 'too_long'],
    ['Texte avec contrôle \u0007', 'control'], ['Inversion \u202edu sens', 'control'], ['Isolat \u2066bidi', 'control'],
    ['Écrit à client@example.test', 'email'], ['Adresse: prenom.nom@exemple.ch.', 'email'],
    ['Voir https://resend.com/emails/abc', 'link'], ['lien www.exemple.test', 'link'], ['resend.com/emails/abc', 'link'], ['ftp://serveur', 'link'],
    ['Message 4ef9a417-02e9-4d39-ad75-9611e0fcc33c', 'identifier'],
    ['Session cs_live_fictifA1B2c3D4', 'identifier'], ['Paiement pi_fictif3NfX12', 'identifier'], ['Clé re_fictif123456', 'identifier'], ['whsec_fictif1234', 'identifier'],
    ['Jeton Zk3Qm9Xv2Lp8Rt5Wn1Yb7Hc4', 'identifier'], ['Empreinte 3f46cde9a0b1c2d3e4f5a6b7c8d9', 'identifier'], ['Carte 4242424242424242', 'identifier'],
  ])('refuse %j (%s)', (text, problem) => expect(check(text)).toBe(problem));

  it('normalise les retours à la ligne et les bords sans toucher au contenu', () => {
    expect(normalizeResolutionNote('  Ligne une\r\nLigne deux\rLigne trois\t fin  ')).toBe('Ligne une\nLigne deux\nLigne trois  fin');
  });

  it('ne reconnaît que les types de résolution fermés', () => {
    expect(RESOLUTION_KINDS.every(isResolutionKind)).toBe(true);
    for (const value of ['autre', 'NO_ACTION', '', null, undefined, 1, 'constructor', '__proto__']) expect(isResolutionKind(value)).toBe(false);
  });
});
