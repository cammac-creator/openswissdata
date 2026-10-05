#!/usr/bin/env node
// Garde-fou de la frontière de l'argent d'OpenSwissData (charte osd.F03, 02.10.2026).
// Hook PreToolUse : lit l'appel d'outil sur l'entrée standard et REFUSE (code 2) tout ce qui touche F1 à F7,
// la lecture d'un secret, ou toute action quand le fichier ARRET existe. Toute erreur interne refuse aussi
// (échec fermé). Aucune dépendance, aucun réseau : quelques millisecondes.
// Il n'est passé que par `--settings .claude/garde-fous.json` aux exécutions NON surveillées. Jamais dans
// managed-settings.json ni dans les réglages utilisateur.
// Preuve avant confiance : node .claude/hooks/garde-financier.mjs --rejouer .claude/hooks/garde-financier.cas.json
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const F2 = [
  'web/src/lib/offers.ts', 'src/db/seed.ts', 'web/src/components/PricingPage.astro', 'web/src/scripts/pricing.ts',
  'web/src/pages/**/pricing.astro', 'web/src/pages/pricing.astro', 'src/mcp/oauth/quota.ts', 'src/mcp/oauth/scopes.ts',
  'src/legal/**', 'web/src/content/legal*.ts', 'web/src/components/LegalPage.astro', 'web/src/pages/**/legal/**',
  'web/src/pages/legal/**', 'web/src/lib/customer-care.ts', 'src/routes/checkout.ts', 'src/lib/checkout-*.ts',
  'web/src/components/CheckoutNotice.astro', 'src/routes/stripe-webhook.ts', 'src/lib/stripe.ts',
  'src/lib/stripe-financial.ts', 'src/lib/order-rights.ts', 'src/lib/order-legal.ts', 'src/lib/order-delivery.ts',
  'src/lib/retention-rules.ts',
];
const F7 = [
  '.github/**', '.claude/settings*.json', '.claude/garde-fous.json', '.claude/hooks/**', '.claude/agents/**',
  'scripts/search-eval/cases.json', 'scripts/promesses/**', 'tests/lba/**', 'etl/canary-baseline.json',
  'tests/routes/stripe-*', 'tests/routes/checkout*', 'tests/routes/delivery-contract.test.ts',
  'tests/web/fiches-atlas.test.ts', 'tests/web/service-atlas.test.ts', 'tests/web/order-journey.test.ts',
  'tests/lib/order-legal-version.test.ts', 'tests/etl/finma-coverage-promises.test.ts', 'tests/mcp/token-scope*',
];
const SECRETS = ['.env', '.env.*', '.mcpregistry_*', '**/veille-telegram/creds.env', '**/.ibf-*', '**/.ssh/id_*',
  '**/.claude/quota-alert.env', '**/.mcp_publisher_token'];

// Commandes refusées, par règle. Motifs sur le texte complet de la commande (git -C, sh -c, chemins absolus compris).
const COMMANDES = [
  ['F1', /api\.stripe\.com|\bstripe\s+(refunds|prices|products|coupons|promotion_codes|subscriptions|invoices|credit_notes|payouts|payment_intents|customers|charges|keys|post|delete)\b/i],
  ['F3', /\brailway\s+(variables?|up|service|domain|environment|add|link|redeploy|down)\b|\bwrangler\b|\bgh\s+secret\b|\bvercel\b/i],
  // F4 : une PR EN BROUILLON dans le dépôt du projet reste permise (niveau AUTO du cadre) ; une PR sans --draft,
  // une PR vers un autre dépôt (annuaire tiers), un ticket ou un commentaire public sont refusés (vérifiée le 02.10).
  ['F4', /api\.resend\.com|\bnpm\s+publish\b|mcp-publisher|publish-mcp-registry|\bsendmail\b|\bgh\s+issue\s+(create|comment)\b|\bgh\s+pr\s+(comment|review)\b|\bgh\s+pr\s+create\b(?![^;&|]*--draft)|\bgh\s+pr\s+create\b[^;&|]*(--repo|-R)[\s=]+(?!cammac-creator\/openswissdata\b)\S+/i],
  // RELU : en exécution non surveillée, ni fusion ni poussée directe sur main (le relecteur et la CI doivent passer
  // avant toute mise en ligne ; une session surveillée fusionne). Ajout de la vérification du 02.10.
  ['RELU', /\bgh\s+pr\s+merge\b|\bgit\b[^;&|]*\bpush\b[^;&|]*\s(\S*:)?(refs\/heads\/)?main\b/i],
  ['F6', /\bnpm\s+run\s+etl(:|\b)|etl\/[a-z]+\/release\.ts|\bgit\b[^;&|]*\bpush\b[^;&|]*(--force\b|--force-with-lease|\s-f\b|\s\+\S)|\bfilter-repo\b|\brailway\s+(run|ssh|shell)\b|\bsqlite3\b[^;&|]*\b(delete|drop|update|insert)\b/i],
  ['F7', /\bgh\s+api\b[^;&|]*(-X|--method)\s*(PUT|POST|PATCH|DELETE)[^;&|]*(rulesets|protection|actions\/workflows|collaborators|keys|hooks)/i],
];
const ECRITURE_BASH = /(>>?|\btee\b|\bsed\s+-i|\bperl\s+-i|\brm\b|\bmv\b|\bcp\b|\btruncate\b|\bgit\s+(rm|mv|checkout\s+--|restore)\b)/;
const LECTURE_SECRET_BASH = /\b(cat|less|more|head|tail|grep|awk|sed|cut|strings|xxd|od|base64|source|\.|python3?|node)\b/;

function globRegex(glob) {
  let r = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { r += '.*'; i++; if (glob[i + 1] === '/') i++; }
    else if (c === '*') r += '[^/]*';
    else if ('.+?^${}()|[]\\'.includes(c)) r += '\\' + c;
    else r += c;
  }
  return new RegExp('(^|/)' + r + '$');
}
const F2R = F2.map(globRegex), F7R = F7.map(globRegex), SECR = SECRETS.map(globRegex);
const touche = (chemin, liste) => liste.some(re => re.test(chemin.replace(/\\/g, '/')));
const mentionne = (texte, liste) => texte.split(/[\s'"`=<>|;&()]+/).filter(Boolean).some(mot => touche(mot, liste));

// Ce que le hook ne voit pas seul : une écriture faite par un programme (node -e, python3 -c), git apply,
// git checkout <branche> -- <chemin>. D'où le contrôle de sortie : avant git push ou gh pr create, la liste des
// fichiers modifiés par la branche (git diff --name-only origin/main...HEAD) ne doit contenir aucun chemin F2 ou F7.
// En exécution non surveillée, même l'ajout d'un cas de référence est refusé : le hook ne distingue pas ajout et retrait.
// Si la liste ne peut pas être lue (pas de dépôt, pas d'origin/main), l'appel est refusé (échec fermé).
const SORTIE = /\bgit\b[^;&|]*\bpush\b|\bgh\s+pr\s+create\b/;

export function decider(appel, { arret = false, fichiersModifies = () => [], brancheCourante = () => '' } = {}) {
  if (arret) return 'ARRET : fichier d\'arrêt présent, aucune action';
  const outil = String(appel.tool_name ?? '');
  const e = appel.tool_input ?? {};
  const chemin = String(e.file_path ?? e.notebook_path ?? e.path ?? '');
  if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(outil)) {
    if (touche(chemin, F2R)) return 'F2 : chemin financier ' + chemin;
    if (touche(chemin, F7R)) return 'F7 : garde-fou ' + chemin;
    if (touche(chemin, SECR)) return 'Secret : écriture interdite ' + chemin;
    return null;
  }
  if (outil === 'Read' || outil === 'Grep' || outil === 'Glob') {
    if (touche(chemin, SECR)) return 'Secret : lecture interdite ' + chemin;
    return null;
  }
  if (outil === 'WebFetch') {
    const url = String(e.url ?? '');
    if (/api\.stripe\.com|api\.resend\.com/i.test(url)) return 'F1/F4 : appel interdit ' + url;
    return null;
  }
  if (outil === 'Bash') {
    const cmd = String(e.command ?? '');
    for (const [regle, re] of COMMANDES) if (re.test(cmd)) return regle + ' : commande interdite';
    // Un simple « git push » lancé depuis main (après une fusion locale, par exemple) ne contient pas le mot main :
    // on lit la branche courante de la copie (vérification du 02.10.2026).
    if (/\bgit\b[^;&|]*\bpush\b/.test(cmd) && brancheCourante(appel) === 'main') return 'RELU : poussée depuis la branche main';
    if (SORTIE.test(cmd)) {
      const fichiers = fichiersModifies(appel);
      const f2 = fichiers.find(f => touche(f, F2R));
      if (f2) return 'F2 : la branche modifie un chemin financier (' + f2 + ')';
      const f7 = fichiers.find(f => touche(f, F7R));
      if (f7) return 'F7 : la branche modifie un garde-fou (' + f7 + ')';
    }
    if (ECRITURE_BASH.test(cmd) && mentionne(cmd, F2R)) return 'F2 : écriture sur un chemin financier';
    if (ECRITURE_BASH.test(cmd) && mentionne(cmd, F7R)) return 'F7 : écriture sur un garde-fou';
    if (LECTURE_SECRET_BASH.test(cmd) && mentionne(cmd, SECR)) return 'Secret : lecture interdite';
    return null;
  }
  if (outil.startsWith('mcp__')) {
    // Outils MCP : écritures distantes (GitHub, Stripe, mails) refusées en exécution non surveillée.
    if (/stripe|merge|push|create_or_update_file|delete|send|publish|release|secret/i.test(outil)) return 'F4/F7 : outil MCP ' + outil;
    return null;
  }
  return null;
}

function principal() {
  const racine = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const arret = existsSync(join(racine, '.claude', 'ARRET')) || existsSync(join(homedir(), '.collaboration-agents', 'ARRET'));
  const appel = JSON.parse(readFileSync(0, 'utf8'));
  // `git -C <copie> push` : la liste des fichiers se lit dans la copie nommée, pas dans le dossier courant.
  const dossierGit = a => {
    const m = String(a.tool_input?.command ?? '').match(/\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/);
    return m ? m[1].replace(/^["']|["']$/g, '') : String(a.cwd || racine);
  };
  const fichiersModifies = a => execFileSync('git', ['-C', dossierGit(a), 'diff', '--name-only', 'origin/main...HEAD'],
    { timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
  const brancheCourante = a => execFileSync('git', ['-C', dossierGit(a), 'rev-parse', '--abbrev-ref', 'HEAD'],
    { timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const refus = decider(appel, { arret, fichiersModifies, brancheCourante });
  if (refus) {
    process.stderr.write(`Zone rouge (${refus}). Ne pas contourner : écrire une proposition dans la fiche de chantier et passer à la tâche suivante.\n`);
    process.exit(2);
  }
  process.exit(0);
}

function rejouer(fichier) {
  const cas = JSON.parse(readFileSync(fichier, 'utf8'));
  let ecarts = 0;
  for (const c of cas) {
    const refus = decider(c.appel, { arret: !!c.arret, fichiersModifies: () => c.fichiers_modifies ?? [], brancheCourante: () => c.branche ?? '' });
    const obtenu = refus ? 'refus' : 'accord';
    const ok = obtenu === c.attendu;
    if (!ok) ecarts++;
    console.log(`${ok ? 'ok   ' : 'ÉCART'} ${c.nom} : attendu ${c.attendu}, obtenu ${obtenu}${refus ? ' (' + refus + ')' : ''}`);
  }
  console.log(`${cas.length} cas, ${ecarts} écart(s).`);
  process.exit(ecarts ? 1 : 0);
}

try {
  if (process.argv[2] === '--rejouer') rejouer(process.argv[3]);
  else principal();
} catch {
  // Échec fermé : une entrée illisible ou une erreur du garde-fou refuse l'appel.
  process.stderr.write('Zone rouge (garde-fou en erreur) : appel refusé par prudence.\n');
  process.exit(2);
}
