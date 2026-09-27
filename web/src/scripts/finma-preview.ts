import { readPublicCatalogue } from '../lib/public-catalogue';
type SampleRow = { name: string; entity_type: string; uid?: string | null; lei?: string | null };
interface Catalogue {
  version: string;
  collected_on: string;
  registry_rows: number;
  unique_uids: number;
  warning_rows: number;
  populated_fields: Record<string, number>;
  history: { available_from: string; available_until: string; gaps: Array<{from: string; to: string; days: number}> };
  sample: SampleRow[];
}
const fields = ['name', 'entity_type', 'uid', 'lei'] as const;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function isCatalogue(value: unknown): value is Catalogue {
  if (!object(value) || typeof value.version !== 'string' || !/^\d{4}\.\d{2}\.\d{2}/.test(value.version) || typeof value.collected_on !== 'string') return false;
  if (!count(value.registry_rows) || !count(value.unique_uids) || !count(value.warning_rows) || !object(value.populated_fields)) return false;
  const total = value.registry_rows;
  if (value.unique_uids > total || !['uid','lei','licence_date','status','canton','city','address'].every(key => {
    const amount = (value.populated_fields as Record<string, unknown>)[key];
    return count(amount) && amount <= total;
  })) return false;
  const history = value.history;
  if (!object(history) || typeof history.available_from !== 'string' || typeof history.available_until !== 'string' || !Array.isArray(history.gaps)) return false;
  if (!history.gaps.every(gap => object(gap) && typeof gap.from === 'string' && typeof gap.to === 'string' && count(gap.days))) return false;
  return Array.isArray(value.sample) && value.sample.every(row => object(row)
    && typeof row.name === 'string' && typeof row.entity_type === 'string'
    && ['uid','lei'].every(key => row[key] == null || typeof row[key] === 'string'));
}

const root = document.querySelector<HTMLElement>('[data-finma-product]');
if (root) {
  const copy: { empty: string; unavailable: string; noGap: string; gap: string; days: string } = JSON.parse(root.dataset.copy!);
  const lang = root.dataset.lang as 'fr' | 'de' | 'en';
  const locale = {fr:'fr-CH', de:'de-CH', en:'en'}[lang];
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, {style:'percent', maximumFractionDigits:1});
  const version = document.getElementById('finma-version')!;
  const history = document.getElementById('finma-history')!;
  const input = document.getElementById('finma-search') as HTMLInputElement;
  const tbody = document.getElementById('finma-preview')!;
  const status = document.getElementById('finma-preview-status')!;
  const controls = document.querySelector<HTMLElement>('[data-finma-formats]')!;
  const formatButtons = controls.querySelectorAll<HTMLButtonElement>('button');
  const tablePanel = document.getElementById('finma-format-table')!;
  const codePanel = document.getElementById('finma-format-code')!;
  const code = codePanel.querySelector('code')!;
  let sample: SampleRow[] = [];
  let format = 'table';
  const countLabel = { fr:'lignes affichées dans l’échantillon', de:'angezeigte Zeilen im Muster', en:'rows shown in the sample' }[lang] ?? '';
  function render() {
    const query = input.value.trim().toLocaleLowerCase(lang);
    const rows = sample.filter(row => fields.some(field => row[field]?.toLocaleLowerCase(lang).includes(query))).slice(0,20);
    tbody.replaceChildren();
    for (const row of rows) {
      const tr = document.createElement('tr');
      for (const field of fields) { const td = document.createElement('td'); td.textContent = row[field] || '—'; tr.append(td); }
      tbody.append(tr);
    }
    // Les vues texte montrent les mêmes quatre champs, jamais du HTML de la source.
    code.textContent = format === 'json'
      ? JSON.stringify(rows.map(row => Object.fromEntries(fields.map(field => [field,row[field] ?? null]))), null, 2)
      : [fields.join(','), ...rows.map(row => fields.map(field => `"${(row[field] ?? '').replaceAll('"','""')}"`).join(','))].join('\n');
    status.textContent = rows.length ? `${number.format(rows.length)} ${countLabel}.` : copy.empty;
    tablePanel.hidden = format !== 'table';
    codePanel.hidden = format === 'table';
    formatButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.format === format)));
  }
  input.addEventListener('input', render);
  formatButtons.forEach(button => button.addEventListener('click', () => { format = button.dataset.format!; render(); }));
  readPublicCatalogue('finma').then(data => {
    if (!isCatalogue(data)) throw new Error('Catalogue incomplet');
    version.textContent = `${data.collected_on} · v${data.version}`;
    const counts: Record<string, number> = {registry_rows:data.registry_rows, unique_uids:data.unique_uids, warning_rows:data.warning_rows, lei:data.populated_fields.lei};
    root.querySelectorAll<HTMLElement>('[data-count]').forEach(element => { element.textContent = number.format(counts[element.dataset.count!]); });
    root.querySelectorAll<HTMLElement>('[data-field-count]').forEach(element => {
      const key = element.dataset.fieldCount!;
      const value = data.populated_fields[key];
      element.textContent = `${number.format(value)} / ${number.format(data.registry_rows)}`;
      const share = data.registry_rows > 0 ? value / data.registry_rows : null;
      root.querySelector<HTMLElement>(`[data-field-share="${key}"]`)!.textContent = share === null ? '—' : percent.format(share);
      root.querySelector<HTMLElement>(`[data-field-meter="${key}"]`)!.style.width = `${(share ?? 0)*100}%`;
    });
    const coverage = data.history;
    history.textContent = `${coverage.available_from} → ${coverage.available_until}. ` + (coverage.gaps.length
      ? coverage.gaps.map(gap => `${copy.gap}${lang === 'fr' ? ' :' : ':'} ${gap.from} → ${gap.to} (${gap.days} ${copy.days}).`).join(' ')
      : copy.noGap);
    sample = data.sample;
    input.disabled = false;
    controls.hidden = false;
    render();
  }).catch(() => {
    version.textContent = copy.unavailable;
    history.textContent = copy.unavailable;
    status.textContent = copy.unavailable;
  });
}

export {};
