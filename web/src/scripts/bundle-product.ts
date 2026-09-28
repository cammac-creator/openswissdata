import { readPublicCatalogue } from '../lib/public-catalogue';

/** Page bundle : retour de paiement expliqué, versions servies et barres animées si le mouvement est permis. */
const root = document.querySelector<HTMLElement>('[data-bundle-product]');
if (root) {
  const copy: Record<'lang' | 'loading' | 'unavailable' | 'codes' | 'classCodes' | 'rows' | 'cancelled' | 'error', string> = JSON.parse(root.dataset.copy!);
  const lang = copy.lang as 'fr' | 'de' | 'en';
  const number = new Intl.NumberFormat({ fr: 'fr-CH', de: 'de-CH', en: 'en-GB' }[lang]);

  // Stripe renvoie ici toute interruption ou erreur d'achat de fichiers, quel que soit le produit choisi.
  const banner = root.querySelector<HTMLElement>('[data-checkout-banner]')!;
  const status = new URLSearchParams(location.search).get('checkout');
  if (status === 'cancelled' || status === 'error') {
    banner.textContent = status === 'cancelled' ? copy.cancelled : copy.error;
    banner.classList.toggle('is-error', status === 'error');
    banner.hidden = false;
  }

  for (const id of ['tares', 'classifications', 'finma'] as const) {
    const version = root.querySelector<HTMLElement>(`[data-live-version="${id}"]`)!;
    const count = root.querySelector<HTMLElement>(`[data-live-count="${id}"]`)!;
    readPublicCatalogue(id).then(data => {
      const total = id === 'finma' ? data.registry_rows : data.rows;
      if (typeof data.version !== 'string' || !/^\d{4}\.\d{2}\.\d{2}/.test(data.version)) throw new Error('Version absente');
      if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) throw new Error('Volume absent');
      version.textContent = `v${data.version}`;
      count.textContent = `${number.format(total)} ${id === 'finma' ? copy.rows : id === 'tares' ? copy.codes : copy.classCodes}`;
    }).catch(() => {
      version.textContent = copy.unavailable;
      count.textContent = '';
    });
  }

  const bars = root.querySelector<HTMLElement>('[data-bundle-bars]');
  if (bars && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      if (document.querySelector<HTMLElement>('.atlas-site')?.dataset.motion !== 'on') return;
      bars.querySelectorAll<SVGElement>('.fiche-bar').forEach((bar, index) => {
        bar.animate?.([{ transform: 'scaleX(.04)' }, { transform: 'scaleX(1)' }], { duration: 900, delay: index * 220, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' });
      });
    }, { threshold: 0.4 });
    observer.observe(bars);
  }
}

export {};
