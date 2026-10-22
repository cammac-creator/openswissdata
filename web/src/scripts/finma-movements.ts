/**
 * Vitrine « Mouvements FINMA » : bouton « être prévenu », amélioration progressive.
 * Sans JavaScript, le bouton reste caché (la route lit du JSON : un formulaire recevrait un 400)
 * et la page reste entière. Un clic envoie un seul événement anonyme, sans adresse ni contact :
 * le nom de l'événement et la langue de la page. Textes posés par textContent.
 */
const box = document.querySelector<HTMLElement>('[data-movements-interest]');
const button = box?.querySelector<HTMLButtonElement>('[data-interest]');
const note = box?.querySelector<HTMLElement>('[data-interest-note]');
const statusLine = box?.querySelector<HTMLElement>('[data-interest-status]');
if (box && button && statusLine && box.dataset.event) {
  const event = box.dataset.event;
  button.hidden = false;
  if (note) note.hidden = false;
  let sent = false;
  button.addEventListener('click', async () => {
    if (sent) return;
    sent = true;
    button.disabled = true;
    try {
      const response = await fetch('/api/events/track', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: event, kind: 'custom', meta: { lang: box.dataset.lang ?? 'fr' } }),
        credentials: 'same-origin',
        keepalive: true,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      button.hidden = true;
      statusLine.textContent = box.dataset.thanks ?? '';
    } catch {
      sent = false;
      button.disabled = false;
      statusLine.textContent = box.dataset.error ?? '';
    }
  });
}

export {};
