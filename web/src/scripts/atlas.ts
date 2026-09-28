/** Présentation progressive : tout reste lisible et utilisable sans JavaScript. */
const site = document.querySelector<HTMLElement>('.atlas-site');
if (site) {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const buttons = site.querySelectorAll<HTMLButtonElement>('[data-atlas-motion]');
  let pausedByUser = false;
  const animations = new Set<Animation>();
  const art = site.querySelector<HTMLElement>('[data-atlas-art]');
  let frame = 0;
  const resetArt = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    art?.style.removeProperty('--atlas-rx');
    art?.style.removeProperty('--atlas-ry');
  };
  const paused = () => preference.matches || pausedByUser;
  const syncMotion = () => {
    site.dataset.motion = paused() ? 'off' : 'on';
    buttons.forEach(button => {
      button.hidden = false;
      button.setAttribute('aria-pressed', String(paused()));
      button.disabled = preference.matches;
    });
    if (paused()) {
      resetArt();
      animations.forEach(animation => animation.cancel());
      animations.clear();
    }
  };
  buttons.forEach(button => button.addEventListener('click', () => {
    pausedByUser = !pausedByUser;
    syncMotion();
  }));
  preference.addEventListener('change', syncMotion);
  pointer.addEventListener('change', resetArt);
  syncMotion();

  // L'image réagit très légèrement au pointeur, uniquement sur grand écran.
  art?.addEventListener('pointermove', event => {
    if (paused() || !pointer.matches || window.innerWidth < 900 || art.dataset.reliefState === 'ready') return;
    const box = art.getBoundingClientRect();
    const rx = ((event.clientY - box.top) / box.height - .5) * -4;
    const ry = ((event.clientX - box.left) / box.width - .5) * 4;
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      art.style.setProperty('--atlas-rx', `${rx}deg`);
      art.style.setProperty('--atlas-ry', `${ry}deg`);
      frame = 0;
    });
  });
  art?.addEventListener('pointerleave', resetArt);

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
