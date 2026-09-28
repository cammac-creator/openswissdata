/** Chargement différé du relief ; l'affiche reste disponible en cas d'échec. */
document.querySelectorAll<HTMLElement>('[data-model-url]').forEach(art => {
  const start = art.querySelector<HTMLButtonElement>('[data-relief-start]');
  const status = art.querySelector<HTMLElement>('[data-relief-status]');
  if (!start || !status || !('DecompressionStream' in window)) return;
  start.hidden = false;
  const startLabel = start.textContent;
  let loading = false;
  let ready = false;
  let unmount: (() => void) | undefined;
  art.addEventListener('atlas-relief-failed', () => {
    ready = false;
    start.hidden = false;
    start.disabled = false;
  });
  const load = async (interactive = false) => {
    if (loading || ready) return;
    loading = true;
    start.disabled = true;
    start.textContent = art.dataset.loading || startLabel;
    status.textContent = art.dataset.loading || '';
    art.dataset.reliefState = 'loading';
    try {
      const { mountRelief } = await import('./atlas-relief-scene');
      unmount = await mountRelief(art);
      ready = true;
      start.hidden = true;
      if (interactive) art.querySelector<HTMLElement>('[data-relief-stage]')?.focus({ preventScroll: true });
    } catch {
      art.dataset.reliefState = 'fallback';
      status.textContent = art.dataset.error || '';
      start.disabled = false;
    } finally { loading = false; start.textContent = startLabel; }
  };
  start.addEventListener('click', () => { void load(true); });
  art.querySelector('[data-relief-poster]')?.addEventListener('click', () => {
    unmount?.();
    unmount = undefined;
    ready = false;
    art.dataset.reliefState = 'poster';
    art.dataset.reliefView = 'front';
    art.dataset.touchActive = 'false';
    for (const selector of ['[data-relief-stage]', '[data-relief-actions]', '[data-relief-hint]']) {
      const element = art.querySelector<HTMLElement>(selector);
      if (element) element.hidden = true;
    }
    const touch = art.querySelector<HTMLButtonElement>('[data-relief-touch]');
    if (touch) { touch.setAttribute('aria-pressed', 'false'); touch.textContent = touch.dataset.labelOff || ''; }
    start.hidden = false;
    start.disabled = false;
    status.textContent = art.dataset.artState || '';
    start.focus({ preventScroll: true });
  });
});
