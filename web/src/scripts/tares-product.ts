import { dottedTariff, loadTaresCatalogue, officialSourceUrl, type TaresCatalogue, type TaresSampleRow } from '../lib/tares-catalogue';

/** Fiche TARES : version publiée, volumes et une ligne réelle commentée. Tout reste lisible sans script. */
const root = document.querySelector<HTMLElement>('[data-tares-product]');
if (root) {
  const copy: Record<'lang' | 'waiting' | 'unavailable' | 'checked' | 'compared' | 'noMfn' | 'prefCount' | 'prefNote' | 'free' | 'liveLine' | 'detailCount', string> = JSON.parse(root.dataset.copy!);
  const lang = copy.lang as 'fr' | 'de' | 'en';
  const locale = { fr: 'fr-CH', de: 'de-CH', en: 'en-GB' }[lang];
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 4 });
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Zurich' });
  const version = root.querySelector<HTMLElement>('[data-tares-version]')!;
  const next = root.querySelector<HTMLButtonElement>('[data-tares-next]')!;
  const live = root.querySelector<HTMLElement>('[data-tares-live]')!;
  const source = root.querySelector<HTMLAnchorElement>('[data-tares-source]')!;
  const stack = root.querySelector<HTMLElement>('[data-tares-stack]')!;
  const rateCount = root.querySelector<HTMLElement>('[data-tares-rate-count]')!;
  const field = (name: string) => root.querySelector<HTMLElement>(`[data-tares-field="${name}"]`)!;
  const motion = () => document.querySelector<HTMLElement>('.atlas-site')?.dataset.motion === 'on';
  const designation = (row: TaresSampleRow) => (lang === 'en' ? row.designation_en || row.designation_fr : lang === 'de' ? row.designation_de : row.designation_fr);
  const unit = (row: TaresSampleRow) => (lang === 'fr' ? row.duty_mfn_unit ?? '' : row.unit_stat || row.duty_mfn_unit || '');
  const named = ['eu', 'efta', 'uk', 'cn', 'jp', 'tr'];

  let rows: TaresSampleRow[] = [];
  let position = 0;
  let catalogue: TaresCatalogue | undefined;

  const show = (row: TaresSampleRow) => {
    field('hs8').textContent = dottedTariff(row.hs8);
    field('designation').textContent = designation(row);
    field('duty_mfn').textContent = row.duty_mfn_value == null ? copy.noMfn : `${number.format(row.duty_mfn_value)} CHF · ${unit(row)}`;
    field('duty_mfn').classList.toggle('fiche-muted', row.duty_mfn_value == null);
    const keys = Object.keys(row.preferential_regimes);
    const known = named.filter(key => keys.includes(key));
    field('preferential_regimes').textContent = keys.length
      ? `${number.format(keys.length)} ${copy.prefCount}${known.length ? ` (${known.join(', ')}${keys.length > known.length ? '…' : ''})` : ''} · ${copy.prefNote}`
      : '—';
    field('duty_rates_count').textContent = number.format(row.duty_rates_count);
    field('valid_from').textContent = row.valid_from;
    rateCount.textContent = number.format(row.duty_rates_count);
    const bars = Math.min(row.duty_rates_count, 48);
    stack.replaceChildren(...Array.from({ length: bars }, () => document.createElement('span')));
    stack.classList.toggle('is-more', row.duty_rates_count > bars);
    const url = officialSourceUrl(row.source_url);
    if (url) source.href = url;
    if (catalogue) live.textContent = `${copy.liveLine} v${catalogue.version} · ${dottedTariff(row.hs8)}`;
    if (motion() && typeof stack.animate === 'function') {
      stack.animate([{ opacity: 0.2, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
  };

  loadTaresCatalogue().then(data => {
    catalogue = data;
    version.textContent = `v${data.version} · ${copy.checked} ${date.format(new Date(data.checked_at))} · ${copy.compared} v${data.previous_version}`;
    const counts: Record<string, string> = {
      rows: number.format(data.rows), rates: number.format(data.rates), missing: number.format(data.missing_mfn_summary),
      changes: `+${number.format(data.added)} · −${number.format(data.removed)}`,
    };
    root.querySelectorAll<HTMLElement>('[data-tares-count]').forEach(element => { element.textContent = counts[element.dataset.taresCount!]; });
    // Une ligne parlante d'abord, puis tout l'échantillon, lignes sans résumé comprises.
    const rich = data.sample.filter(row => row.duty_mfn_value != null && row.duty_rates_count >= 3 && Object.keys(row.preferential_regimes).length > 0);
    const preferred = data.sample.find(row => row.hs8 === '22011000');
    rows = [...new Set([...(preferred ? [preferred] : []), ...rich, ...data.sample])];
    show(rows[0]);
    next.hidden = false;
  }).catch(() => {
    version.textContent = copy.unavailable;
    live.textContent = copy.unavailable;
  });

  next.addEventListener('click', () => {
    if (!rows.length) return;
    position = (position + 1) % rows.length;
    show(rows[position]);
  });

  // Le numéro se compose chiffre par chiffre à son entrée, seulement si les animations sont permises.
  const anatomy = root.querySelector<HTMLElement>('[data-tares-anatomy]');
  if (anatomy && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      if (!motion()) return;
      anatomy.querySelectorAll<HTMLElement>('.fiche-tile').forEach((tile, index) => {
        tile.animate?.([{ opacity: 0.15, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: index * 70, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' });
      });
      anatomy.querySelectorAll<HTMLElement>('.fiche-level-line').forEach((line, index) => {
        line.animate?.([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 650, delay: 500 + index * 160, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' });
      });
    }, { threshold: 0.35 });
    observer.observe(anatomy);
  }
}

export {};
