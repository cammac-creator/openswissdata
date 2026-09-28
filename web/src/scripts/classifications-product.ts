import { loadClassificationsCatalogue, SCHEME_IDS, type ClassificationSampleRow, type SchemeId } from '../lib/classifications-catalogue';

/** Fiche classifications : version, volumes par nomenclature et échantillon réel, en textContent uniquement. */
const root = document.querySelector<HTMLElement>('[data-class-product]');
if (root) {
  const copy: { lang: 'fr' | 'de' | 'en'; rowsWord: string; waiting: string; unavailable: string; checked: string; codes: string; classes: string; viewerEmpty: string; isicLabel: string; levelLabels: Record<string, string> } = JSON.parse(root.dataset.copy!);
  const lang = copy.lang;
  const locale = { fr: 'fr-CH', de: 'de-CH', en: 'en-GB' }[lang];
  const number = new Intl.NumberFormat(locale);
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Zurich' });
  const version = root.querySelector<HTMLElement>('[data-class-version]')!;
  const viewer = root.querySelector<HTMLElement>('[data-class-viewer]')!;
  const tabs = viewer.querySelector<HTMLElement>('[data-class-tabs]')!;
  const buttons = tabs.querySelectorAll<HTMLButtonElement>('button[data-scheme]');
  const body = viewer.querySelector<HTMLElement>('[data-class-rows]')!;
  const status = viewer.querySelector<HTMLElement>('[data-class-status]')!;
  let sample: ClassificationSampleRow[] = [];
  let selected: SchemeId = 'NOGA_2025';

  // ISIC n'a pas de libellé allemand officiel : la fiche le dit et montre l'anglais.
  const labelOf = (row: ClassificationSampleRow): string => {
    const own = lang === 'de' ? row.label_de : lang === 'en' ? row.label_en : row.label_fr;
    if (own) return own;
    return (lang === 'de' && row.scheme === 'ISIC_4' && row.label_en) ? `${row.label_en} (EN)` : '—';
  };
  const render = () => {
    const rows = sample.filter(row => row.scheme === selected);
    body.replaceChildren();
    for (const row of rows) {
      const tr = document.createElement('tr');
      for (const value of [row.code, labelOf(row), copy.levelLabels[row.level] ?? row.level, row.parent ?? '—']) {
        const cell = document.createElement('td');
        cell.textContent = value;
        tr.append(cell);
      }
      body.append(tr);
    }
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.scheme === selected)));
    const note = selected === 'ISIC_4' && copy.isicLabel ? ` ${copy.isicLabel}` : '';
    status.textContent = rows.length ? `${number.format(rows.length)} ${copy.rowsWord} · ${selected.replace('_', ' ')}.${note}` : copy.viewerEmpty;
  };
  buttons.forEach(button => button.addEventListener('click', () => {
    selected = button.dataset.scheme as SchemeId;
    render();
  }));

  loadClassificationsCatalogue().then(data => {
    version.textContent = `v${data.version} · ${copy.checked} ${date.format(new Date(data.checked_at))}`;
    const counts: Record<string, number> = { rows: data.rows, links: data.links, exact: data.exact, approximate: data.approximate };
    root.querySelectorAll<HTMLElement>('[data-class-count]').forEach(element => { element.textContent = number.format(counts[element.dataset.classCount!]); });
    for (const id of SCHEME_IDS) {
      const codes = `${number.format(data.schemes[id].rows)} ${copy.codes}`, classes = `${number.format(data.schemes[id].classes)} ${copy.classes}`;
      root.querySelectorAll<HTMLElement>(`[data-scheme-count="${id}"]`).forEach(element => { element.textContent = `${codes} · ${classes}`; });
      // Dans le tableau, codes et classes sur deux lignes pour rester lisibles sur téléphone.
      root.querySelectorAll<HTMLElement>(`[data-scheme-table="${id}"]`).forEach(element => {
        element.replaceChildren(...[codes, classes].map(text => { const line = document.createElement('span'); line.textContent = text; return line; }));
      });
    }
    sample = data.sample;
    tabs.hidden = false;
    render();
  }).catch(() => {
    version.textContent = copy.unavailable;
    status.textContent = copy.unavailable;
  });

  // L'exemple 18.11 s'affiche d'emblée : un événement simulé n'envoie jamais le formulaire lui-même.
  const showExample = () => root.querySelector<HTMLFormElement>('.classification-demo form')?.dispatchEvent(new Event('submit', { cancelable: true }));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showExample, { once: true });
  else setTimeout(showExample, 0);
}

export {};
