// Formulaire « être prévenu par e-mail » de la vitrine /finma-movements/ (24.10.2026) : textes FR/DE/EN, case non
// cochée, lien vers la notice, script local sans stockage, accord exact avec la route du serveur.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MOVEMENTS_SIGNUP_SUBJECT, movementsCopy, movementsPage } from '../../web/src/lib/finma-movements';
import { ANNOUNCEMENT_SUBJECTS } from '../../src/lib/announcements.js';
import { announcementPrivacyPath } from '../../src/lib/announcement-page.js';

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const LANGS = ['fr', 'de', 'en'] as const;

describe('Vitrine FINMA : inscription par e-mail', () => {
  it('textes FR validés, et leurs traductions DE et EN de même sens, sans promesse ni prix', () => {
    const fr = movementsCopy('fr').signup;
    expect(fr.consent).toBe('Je veux être prévenu(e) par e-mail quand l’historique détaillé sera disponible');
    expect(fr.success).toBe('Si l’adresse est valide, un e-mail de confirmation vient de partir.');
    expect(movementsCopy('de').signup.consent).toBe('Ich möchte per E-Mail benachrichtigt werden, wenn der detaillierte Verlauf verfügbar ist');
    expect(movementsCopy('en').signup.consent).toBe('I want to be notified by e-mail when the detailed history is available');
    for (const lang of LANGS) {
      const texts = Object.values(movementsCopy(lang).signup);
      expect(texts.every(text => typeof text === 'string' && text.length > 0)).toBe(true);
      for (const text of texts) expect(text).not.toMatch(/bientôt|prochainement|bald|demnächst|\bsoon\b|coming|CHF|\bprix\b|Preis|\bprice\b|abonnement|subscription|\d/i);
    }
  });

  it.each(LANGS)('%s : sujet accepté par le serveur, lien vers la section « Finalités » de la notice dans la langue de la page', lang => {
    const page = movementsPage(undefined, lang);
    expect(page.signup.subject).toBe(MOVEMENTS_SIGNUP_SUBJECT);
    expect((ANNOUNCEMENT_SUBJECTS as readonly string[]).includes(page.signup.subject)).toBe(true);
    expect(page.signup.privacyHref).toBe(announcementPrivacyPath(lang));
    expect(page.signup.privacyHref).toBe(`${lang === 'fr' ? '' : '/' + lang}/legal/privacy#finalites`);
  });

  it('la notice de confidentialité a bien la section « finalites » en FR, DE et EN', () => {
    const legal = read('web/src/content/legal.ts');
    expect(legal.match(/id: "finalites"/g)).toHaveLength(3);
  });

  it('composant : formulaire caché sans JavaScript, case non cochée, étiquettes, zone annoncée, aucune ressource tierce', () => {
    const component = read('web/src/components/AnnouncementSignup.astro');
    expect(component).toMatch(/<form class="mv-signup" data-announcement-signup[^>]*novalidate hidden>/);
    const checkbox = /<input id=\{`\$\{id\}-consent`\} type="checkbox"[^>]*\/>/.exec(component)?.[0];
    expect(checkbox).toBeDefined();
    expect(checkbox).not.toMatch(/\bchecked\b/);
    expect(component).toContain('<label class="mv-signup-label" for={`${id}-email`}>');
    expect(component).toContain('<label class="mv-signup-consent" for={`${id}-consent`}>');
    expect(component).toContain('type="email" name="email" required maxlength="254"');
    expect(component).toContain('autocomplete="email"');
    expect(component).toMatch(/role="status" aria-atomic="true" data-signup-status/);
    expect(component).toContain('<a href={privacyHref}>{copy.privacyLink}</a>');
    expect(component).toContain("import '../scripts/announcement-signup';");
    expect(component).not.toMatch(/https?:\/\//);
    expect(component).not.toMatch(/\bchecked\b/);
  });

  it('vitrine : le bouton anonyme reste, le formulaire vient juste dessous, la page n’a toujours ni formulaire ni appel réseau en propre', () => {
    const page = read('web/src/components/FinmaMovementsPage.astro');
    const button = page.indexOf('<button type="button" class="atlas-btn" data-interest hidden>');
    const signup = page.indexOf('<AnnouncementSignup lang={lang} subject={page.signup.subject} privacyHref={page.signup.privacyHref} copy={page.signup.copy} />');
    expect(button).toBeGreaterThan(0);
    expect(signup).toBeGreaterThan(button);
    expect(page).not.toMatch(/<form\b|fetch\(/);
  });

  it('script : un seul appel JSON vers la route de même origine, consentement explicite, rien gardé dans le navigateur', () => {
    const script = read('web/src/scripts/announcement-signup.ts');
    expect(script.match(/fetch\(/g)).toHaveLength(1);
    expect(script).toContain("fetch('/api/announcements/request'");
    expect(script).toContain('JSON.stringify({ email: address, lang, subject, consent: true })');
    expect(script).toContain("credentials: 'same-origin'");
    expect(script).toContain('if (!consent.checked)');
    expect(script).toContain('form.hidden = false;');
    expect(script).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|localStorage|sessionStorage|indexedDB|document\.cookie|https?:\/\//);
    // L'ancien script du bouton reste sans adresse ni inscription.
    expect(read('web/src/scripts/finma-movements.ts')).not.toMatch(/email|mail|announcement/i);
  });
});
