/** Présentation progressive : tout reste lisible et utilisable sans JavaScript. */
const site = document.querySelector<HTMLElement>('.atlas-site');
if (site) {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const buttons = site.querySelectorAll<HTMLButtonElement>('[data-atlas-motion]');
  let pausedByUser = false;
  const animations = new Set<Animation>();
  const paused = () => preference.matches || pausedByUser;
  const syncMotion = () => {
    site.dataset.motion = paused() ? 'off' : 'on';
    buttons.forEach(button => {
      button.hidden = false;
      button.setAttribute('aria-pressed', String(paused()));
      button.disabled = preference.matches;
    });
    if (paused()) {
      animations.forEach(animation => animation.cancel());
      animations.clear();
    }
  };
  buttons.forEach(button => button.addEventListener('click', () => {
    pausedByUser = !pausedByUser;
    syncMotion();
  }));
  preference.addEventListener('change', syncMotion);
  syncMotion();

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        if (paused() || typeof entry.target.animate !== 'function') return;
        const animation = entry.target.animate([
          { transform: 'translateY(18px)' },
          { transform: 'translateY(0)' },
        ], { duration: 650, easing: 'cubic-bezier(.16,1,.3,1)' });
        animations.add(animation);
        animation.onfinish = () => animations.delete(animation);
      });
    }, { threshold: .08 });
    site.querySelectorAll('[data-atlas-enter]').forEach(element => observer.observe(element));
  }

  // Le menu natif fonctionne également sans script. Échap rend le focus au bouton.
  const menu = site.querySelector<HTMLDetailsElement>('[data-atlas-menu]');
  const closeMenu = (focus: boolean) => {
    if (!menu?.open) return;
    menu.open = false;
    if (focus) menu.querySelector('summary')?.focus();
  };
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu?.open) { closeMenu(true); event.preventDefault(); }
  });
  document.addEventListener('click', event => {
    if (event.target instanceof Node && menu?.open && !menu.contains(event.target)) closeMenu(false);
  });
  document.addEventListener('focusin', event => {
    if (event.target instanceof Node && menu?.open && !menu.contains(event.target)) closeMenu(false);
  });
  menu?.addEventListener('focusin', event => {
    if (menu.open && event.target instanceof HTMLAnchorElement) {
      event.target.scrollIntoView({ behavior:'auto', block:'nearest', inline:'nearest' });
    }
  });
  menu?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => closeMenu(false)));
  window.matchMedia('(min-width: 981px)').addEventListener('change', event => {
    if (event.matches) closeMenu(false);
  });

  // Conserver le lien, l'historique et le focus après une navigation dans la page.
  site.querySelectorAll<HTMLAnchorElement>('a[href*="#"]').forEach(link => {
    link.addEventListener('click', event => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      const url = new URL(link.href);
      if (url.origin !== location.origin || url.pathname !== location.pathname || !url.hash) return;
      const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
      if (!target) return;
      event.preventDefault();
      closeMenu(false);
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      target.scrollIntoView({ behavior: paused() ? 'auto' : 'smooth', block: 'start' });
      if (location.hash !== url.hash) history.pushState(null, '', url.hash);
    });
  });
}

export {};
