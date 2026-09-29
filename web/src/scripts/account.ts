/**
 * Espace client : affichage seulement. Les appels réseau reprennent à l’identique ceux de
 * l’ancien script en ligne (adresse, méthode, en-têtes, corps, credentials:"include") ;
 * tests/web/service-atlas.test.ts les verrouille. Aucune logique de session, de cookie,
 * d’origine ni de téléchargement n’est décidée ici. Tout texte venu du serveur passe par
 * textContent, jamais par innerHTML.
 */
type Strings = Record<string, string>;
interface Product { label: string; formats: string; href: string }
interface Copy { s: Strings; accountPath: string; dateLocale: string; products: Record<string, Product> }
interface Dataset { id: string; name: string; current_version: string | null; updates_until: number | null }
interface Order { id: number; amount_chf: number; refunded_chf?: number; status?: string; created_at: number; legal?: { status?: string; url?: string; terms_version?: string; locale?: string } | null }

const root = document.querySelector<HTMLElement>('[data-account]');
if (root) start(root, JSON.parse(root.dataset.account ?? '{}') as Copy);

function start(root: HTMLElement, copy: Copy) {
  const s = copy.s;
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const banner = $<HTMLParagraphElement>('banner');
  const loadingEl = $<HTMLElement>('loading-view');
  const loginEl = $<HTMLElement>('login-view');
  const dashEl = $<HTMLElement>('dashboard-view');
  const listEl = $<HTMLUListElement>('datasets-list');
  const emptyEl = $<HTMLElement>('empty-state');
  const filesError = $<HTMLParagraphElement>('files-error');
  const emailLabelEl = $<HTMLElement>('dashboard-email');
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const showBanner = (text: string, tone: 'success' | 'warn' | 'error') => {
    banner.textContent = text;
    banner.className = 'service-banner' + (tone === 'success' ? ' is-success' : tone === 'error' ? ' is-error' : '');
    banner.hidden = false;
  };
  const formatDate = (value: number) => new Date(value).toLocaleDateString(copy.dateLocale);

  // Retour de paiement Stripe d’abord, puis retour de connexion (même ordre qu’avant).
  const qs = new URLSearchParams(window.location.search);
  const checkoutStatus = qs.get('checkout'), authStatus = qs.get('auth');
  if (checkoutStatus === 'success') showBanner(s.bannerCheckoutSuccess, 'success');
  else if (checkoutStatus === 'cancelled') showBanner(s.bannerCheckoutCancelled, 'warn');
  else if (authStatus === 'ok') showBanner(s.bannerAuthOk, 'success');
  else if (authStatus === 'invalid') showBanner(s.bannerAuthInvalid, 'error');
  else if (authStatus === 'expired') showBanner(s.bannerAuthExpired, 'warn');

  loadingEl.hidden = false;

  function showLogin() {
    loadingEl.hidden = true;
    dashEl.hidden = true;
    loginEl.hidden = false;
  }

  function showDashboard(customer: { email?: string } | null, datasets: Dataset[] | null) {
    loadingEl.hidden = true;
    loginEl.hidden = true;
    dashEl.hidden = false;
    emailLabelEl.textContent = customer?.email ?? '';
    loadReceipts().catch(() => console.warn('Reçus temporairement indisponibles'));
    listEl.replaceChildren();
    if (datasets === null) {
      // La liste n’a pas pu être lue : ne pas présenter un compte vide à tort.
      emptyEl.hidden = true;
      filesError.textContent = s.filesError;
      filesError.hidden = false;
      return;
    }
    filesError.hidden = true;
    if (datasets.length === 0) { emptyEl.hidden = false; return; }
    emptyEl.hidden = true;
    for (const d of datasets) listEl.appendChild(fileCard(d));
  }

  function fileCard(d: Dataset) {
    const product = copy.products[d.id];
    const li = el('li', `compte-file compte-file-${d.id}`);
    const head = el('div', 'compte-file-head');
    const titles = el('div');
    if (product) titles.appendChild(el('p', 'compte-file-kicker', product.label));
    titles.appendChild(el('h2', undefined, d.name));
    const zip = el('span', 'compte-file-zip', 'ZIP');
    zip.setAttribute('aria-hidden', 'true');
    head.append(titles, zip);

    const meta = el('dl', 'compte-file-meta');
    const pair = (label: string, value: string) => { const box = el('div'); box.append(el('dt', undefined, label), el('dd', undefined, value)); meta.appendChild(box); };
    pair(s.versionLabel, d.current_version ? 'v' + d.current_version : s.noVersion);
    const ended = d.updates_until !== null && d.updates_until < Date.now();
    if (d.updates_until) pair(ended ? s.endedLabel : s.untilLabel, formatDate(d.updates_until));
    li.append(head, meta);
    if (product) li.appendChild(el('p', 'compte-file-formats', product.formats));
    if (ended) li.appendChild(el('p', 'compte-file-note', s.endedNote));

    const actions = el('div', 'compte-file-actions');
    const btn = el('button', 'atlas-btn compte-file-btn');
    btn.type = 'button';
    btn.dataset.id = d.id;
    const label = el('span', undefined, s.dlDownload), arrow = el('span', undefined, '↓');
    arrow.setAttribute('aria-hidden', 'true');
    btn.append(label, arrow);
    const status = el('p', 'compte-file-status');
    status.setAttribute('role', 'status');
    actions.appendChild(btn);
    if (product) { const link = el('a', 'atlas-text-link', s.productPage); link.href = product.href; actions.appendChild(link); }
    actions.appendChild(status);
    li.appendChild(actions);

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      label.textContent = s.dlPreparing;
      status.textContent = '';
      status.className = 'compte-file-status';
      let response: Response;
      try {
        response = await fetch('/api/account/download-request', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ dataset_id: d.id }),
        });
      } catch {
        return failDownload(s.network);
      }
      if (!response.ok) {
        const err = await response.json().catch(() => ({})) as { error?: string };
        return failDownload(response.status === 401 ? s.dlSession
          : response.status === 403 || err.error === 'no_entitlement' ? s.dlForbidden
          : err.error === 'no_eligible_version' ? s.dlNoVersion : s.dlUnavailable);
      }
      try {
        const body = await response.json() as { download_url: string };
        window.location.href = body.download_url;
        btn.disabled = false;
        label.textContent = s.dlDownload;
        status.textContent = s.dlStarted;
        status.className = 'compte-file-status is-ok';
      } catch {
        failDownload(s.dlUnavailable);
      }
    });

    function failDownload(message: string) {
      btn.disabled = false;
      label.textContent = s.dlRetry;
      status.textContent = message;
      status.className = 'compte-file-status is-error';
    }
    return li;
  }

  async function loadReceipts() {
    const r = await fetch('/api/account/orders', { credentials: 'include' });
    if (!r.ok) return;
    const { orders } = await r.json() as { orders: Order[] };
    if (!orders.length) return;
    const section = $<HTMLElement>('receipts-section');
    const list = $<HTMLUListElement>('receipts-list');
    list.replaceChildren();
    for (const order of orders) {
      const li = el('li', 'compte-receipt');
      const main = el('div', 'compte-receipt-main');
      main.append(el('span', 'compte-receipt-date', `${s.orderLabel} ${formatDate(order.created_at)}`), el('strong', undefined, (order.amount_chf / 100).toFixed(2) + ' CHF'));
      if (order.status === 'refunded') main.appendChild(el('span', 'compte-receipt-flag', s.refunded));
      else if (typeof order.refunded_chf === 'number' && order.refunded_chf > 0) main.appendChild(el('span', 'compte-receipt-flag', s.partialRefund + (order.refunded_chf / 100).toFixed(2) + ' CHF'));

      const legal = el('p', 'compte-receipt-legal');
      if (order.legal?.status === 'accepted' && /^\/(?:de\/|en\/)?legal\/versions\/\d{4}-\d{2}-\d{2}\/cgv$/.test(order.legal.url ?? '')) {
        const link = el('a', undefined, s.legalAccepted + ' · ' + order.legal.terms_version + ' · ' + String(order.legal.locale).toUpperCase());
        link.href = order.legal.url!;
        legal.appendChild(link);
      } else {
        legal.textContent = s.legalNone;
      }
      main.appendChild(legal);

      const button = el('button', 'atlas-btn atlas-btn-secondary compte-receipt-btn');
      button.type = 'button';
      const text = el('span', undefined, s.receipt), arrow = el('span', undefined, '↗');
      arrow.setAttribute('aria-hidden', 'true');
      button.append(text, arrow);
      const status = el('p', 'compte-receipt-status');
      status.setAttribute('role', 'status');
      button.addEventListener('click', async () => {
        button.disabled = true;
        text.textContent = s.receiptOpening;
        status.textContent = '';
        try {
          const receipt = await fetch('/api/account/orders/' + order.id + '/receipt', { credentials: 'include' });
          if (!receipt.ok) throw new Error('receipt_unavailable');
          const data = await receipt.json() as { url: string };
          window.location.href = data.url;
        } catch {
          status.textContent = s.receiptError;
        } finally { button.disabled = false; text.textContent = s.receipt; }
      });
      li.append(main, button, status);
      list.appendChild(li);
    }
    section.hidden = false;
  }

  const TIER_LABELS: Record<string, string> = { standalone: s.tierStandalone, business: s.tierBusiness, pro: s.tierPro, standard: s.tierStandard, free: s.tierFree };

  async function loadMcp() {
    const sectionEl = $<HTMLElement>('mcp-section');
    const metaEl = $<HTMLElement>('mcp-meta');
    const msgEl = $<HTMLElement>('mcp-msg');
    const btn = $<HTMLButtonElement>('mcp-portal-btn');
    const btnLabel = btn.firstChild as Text | null;
    try {
      const r = await fetch('/api/account/mcp', { credentials: 'include' });
      if (!r.ok) return;
      const body = await r.json() as { mcp_client: { client_id: string; tier: string } | null };
      const client = body.mcp_client;
      if (!client || client.tier === 'free') return; // Seulement pour un abonnement payant.
      metaEl.textContent = (TIER_LABELS[client.tier] || client.tier) + s.mcpKey + client.client_id;
      sectionEl.hidden = false;
      const initial = btnLabel?.textContent ?? '';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        if (btnLabel) btnLabel.textContent = s.mcpOpening;
        msgEl.textContent = '';
        try {
          const pr = await fetch('/api/account/billing-portal', { method: 'POST', credentials: 'include' });
          if (!pr.ok) throw new Error('HTTP ' + pr.status);
          const pb = await pr.json() as { url: string };
          window.location.href = pb.url;
        } catch {
          btn.disabled = false;
          if (btnLabel) btnLabel.textContent = initial || s.mcpRetry;
          msgEl.textContent = s.mcpPortalError;
        }
      });
    } catch {
      // Sans effet sur le tableau de bord : la section MCP reste masquée.
    }
  }

  async function load() {
    try {
      const meRes = await fetch('/api/account', { credentials: 'include' });
      if (meRes.status === 401) { showLogin(); return; }
      if (!meRes.ok) throw new Error('HTTP ' + meRes.status);
      const meBody = await meRes.json() as { customer: { email?: string } | null };
      const dsRes = await fetch('/api/account/datasets', { credentials: 'include' });
      const dsBody = dsRes.ok ? await dsRes.json() as { datasets: Dataset[] } : null;
      showDashboard(meBody.customer, dsBody ? dsBody.datasets : null);
      loadMcp();
    } catch {
      const text = loadingEl.querySelector<HTMLElement>('[data-loading-text]');
      loadingEl.classList.add('is-error');
      if (text) text.textContent = s.loadError;
    }
  }

  const form = $<HTMLFormElement>('login-form');
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const email = String(fd.get('email') || '').trim();
    if (!email) return;
    const msgEl = $<HTMLParagraphElement>('login-msg');
    msgEl.textContent = s.loginSending;
    msgEl.className = 'compte-msg';
    if (submit) submit.disabled = true;
    try {
      const r = await fetch('/api/auth/magic-link', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email }),
      });
      if (r.ok) {
        msgEl.textContent = s.loginSuccess;
        msgEl.className = 'compte-msg is-ok';
      } else {
        msgEl.textContent = r.status === 429 ? s.loginLimited : r.status === 400 ? s.loginInvalid : r.status === 503 ? s.loginUnavailable : s.loginError;
        msgEl.className = 'compte-msg is-error';
      }
    } catch {
      msgEl.textContent = s.loginNetworkError;
      msgEl.className = 'compte-msg is-error';
    } finally {
      if (submit) submit.disabled = false;
    }
  });

  const logout = $<HTMLButtonElement>('logout-btn');
  logout.addEventListener('click', async () => {
    const initial = logout.textContent;
    logout.disabled = true;
    logout.textContent = s.logoutPending;
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error('logout_unconfirmed');
      window.location.href = copy.accountPath;
    } catch {
      showBanner(s.logoutError, 'error');
      banner.scrollIntoView({ block: 'nearest' });
      logout.disabled = false;
      logout.textContent = initial;
    }
  });

  root.dataset.ready = 'true';
  load();
}

export {};
