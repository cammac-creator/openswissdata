/** Chargement différé du relief ; l'affiche reste disponible en cas d'échec. */
document.querySelectorAll<HTMLElement>('[data-model-url]').forEach(art => {
  const start = art.querySelector<HTMLButtonElement>('[data-relief-start]');
  const status = art.querySelector<HTMLElement>('[data-relief-status]');
  if (!start || !status || !('DecompressionStream' in window)) return;
  start.hidden = false;
  const startLabel = start.textContent;
  let loading = false;
  let ready = false;
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
      await mountRelief(art);
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
  // Les téléphones et les connexions économes gardent un chargement explicite.
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (matchMedia('(hover: hover) and (pointer: fine)').matches && !connection?.saveData && !['slow-2g', '2g'].includes(connection?.effectiveType || '') && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void load();
    }, { rootMargin: '100px' });
    observer.observe(art);
  }
});
