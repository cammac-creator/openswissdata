import { readPublicCatalogue } from '../lib/public-catalogue';

/** Page du lot, retiré de la vente : retour de paiement expliqué et versions servies des fichiers en vente. */
const root = document.querySelector<HTMLElement>('[data-bundle-product]');
if (root) {
  const copy: Record<'lang' | 'loading' | 'unavailable' | 'codes' | 'rows' | 'cancelled' | 'error', string> = JSON.parse(root.dataset.copy!);
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

  for (const id of ['tares', 'finma'] as const) {
    const version = root.querySelector<HTMLElement>(`[data-live-version="${id}"]`)!;
    const count = root.querySelector<HTMLElement>(`[data-live-count="${id}"]`)!;
    readPublicCatalogue(id).then(data => {
      const total = id === 'finma' ? data.registry_rows : data.rows;
      if (typeof data.version !== 'string' || !/^\d{4}\.\d{2}\.\d{2}/.test(data.version)) throw new Error('Version absente');
      if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) throw new Error('Volume absent');
      version.textContent = `v${data.version}`;
      count.textContent = `${number.format(total)} ${id === 'finma' ? copy.rows : copy.codes}`;
    }).catch(() => {
      version.textContent = copy.unavailable;
      count.textContent = '';
    });
  }
}

export {};
