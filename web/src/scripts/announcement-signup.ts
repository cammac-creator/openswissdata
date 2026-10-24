/**
 * Inscription par e-mail « être prévenu » (24.10.2026), amélioration progressive : sans JavaScript, le formulaire
 * reste caché. Un envoi = un appel JSON à la route de même origine, avec la case cochée explicitement. Messages
 * posés par textContent dans la zone annoncée ; même message de réussite neutre quelle que soit l'adresse.
 * Rien n'est gardé dans le navigateur (ni stockage local, ni cookie).
 */
for (const form of document.querySelectorAll<HTMLFormElement>('[data-announcement-signup]')) {
  const email = form.querySelector<HTMLInputElement>('input[type="email"]');
  const consent = form.querySelector<HTMLInputElement>('input[type="checkbox"]');
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const statusLine = form.querySelector<HTMLElement>('[data-signup-status]');
  const lang = form.dataset.lang, subject = form.dataset.subject;
  if (!email || !consent || !submit || !statusLine || !lang || !subject) continue;
  form.hidden = false;
  const say = (text: string | undefined) => { statusLine.textContent = text ?? ''; };
  email.addEventListener('input', () => email.removeAttribute('aria-invalid'));
  let busy = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const address = email.value.trim();
    if (!address || !email.checkValidity()) {
      email.setAttribute('aria-invalid', 'true');
      say(form.dataset.invalidEmail);
      email.focus();
      return;
    }
    if (!consent.checked) {
      say(form.dataset.consentMissing);
      consent.focus();
      return;
    }
    busy = true;
    submit.disabled = true;
    say('');
    try {
      const response = await fetch('/api/announcements/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: address, lang, subject, consent: true }),
        credentials: 'same-origin',
      });
      if (response.status === 429) { say(form.dataset.tooMany); return; }
      if (response.status === 400) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        if (body?.error === 'consent_required') { say(form.dataset.consentMissing); consent.focus(); return; }
        email.setAttribute('aria-invalid', 'true');
        say(form.dataset.invalidEmail);
        email.focus();
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      email.value = '';
      consent.checked = false;
      say(form.dataset.success);
    } catch {
      say(form.dataset.error);
    } finally {
      busy = false;
      submit.disabled = false;
    }
  });
}

export {};
