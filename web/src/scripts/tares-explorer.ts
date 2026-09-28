import { dottedTariff, loadTaresCatalogue, type TaresSampleRow } from '../lib/tares-catalogue';

/** Aperçu filtrable : textContent uniquement, vingt lignes au plus après filtrage. */
const root = document.querySelector<HTMLElement>('[data-tares-explorer]');
if (root) {
  const copy: { empty: string; shown: string; total: string; noMfn: string; unavailable: string } = JSON.parse(root.dataset.copy!);
  const lang = root.dataset.lang as 'fr' | 'de' | 'en';
  const locale = { fr: 'fr-CH', de: 'de-CH', en: 'en' }[lang];
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 4 });
  const input = root.querySelector<HTMLInputElement>('input[type="search"]')!;
  const body = root.querySelector<HTMLElement>('[data-tares-rows]')!;
  const status = root.querySelector<HTMLElement>('[data-tares-status]')!;
  const designation = (row: TaresSampleRow) => (lang === 'en' ? row.designation_en || row.designation_fr : lang === 'de' ? row.designation_de : row.designation_fr);
  // Les unités restent des données livrées : français dans duty_mfn_unit, anglais dans unit_stat.
  const unit = (row: TaresSampleRow) => (lang === 'fr' ? row.duty_mfn_unit ?? '' : row.unit_stat || row.duty_mfn_unit || '');
  let sample: TaresSampleRow[] = [];
  const render = () => {
    const query = input.value.trim().toLocaleLowerCase(lang);
    const digits = query.replace(/[\s.]/g, '');
    const rows = sample.filter(row => !query || (/^\d+$/.test(digits) && row.hs8.startsWith(digits)) || designation(row).toLocaleLowerCase(lang).includes(query)).slice(0, 20);
    body.replaceChildren();
    for (const row of rows) {
      const tr = document.createElement('tr');
      const cells = [
        dottedTariff(row.hs8),
        designation(row),
        row.duty_mfn_value == null ? copy.noMfn : `${number.format(row.duty_mfn_value)} CHF · ${unit(row)}`,
        number.format(row.duty_rates_count),
        row.valid_from,
      ];
      cells.forEach((value, index) => {
        const cell = document.createElement('td');
        if (index === 2 && row.duty_mfn_value == null) cell.className = 'fiche-muted';
        cell.textContent = value;
        tr.append(cell);
      });
      body.append(tr);
    }
    status.textContent = rows.length ? `${number.format(rows.length)} ${copy.shown} ${number.format(sample.length)} ${copy.total}.` : copy.empty;
  };
  input.addEventListener('input', render);
  loadTaresCatalogue().then(data => {
    sample = data.sample;
    input.disabled = false;
    render();
  }).catch(() => { status.textContent = copy.unavailable; });
}

export {};
