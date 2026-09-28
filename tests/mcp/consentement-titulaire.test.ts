// Consentement MCP : une portée payante exige la session du titulaire, la portée gratuite reste inchangée.
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../../src/index.js';
import {getDb, closeDb} from '../../src/lib/db.js';
import {hashToken, pkceChallengeS256} from '../../src/mcp/oauth/crypto.js';
import {insertClient} from '../../src/mcp/oauth/store.js';
import {TIER_DEFAULT_SCOPES} from '../../src/mcp/oauth/scopes.js';

const WWW = 'https://www.openswissdata.com', MCP = 'https://mcp.openswissdata.com';
const PAID = 'osd_payant_fictif', SECRET = 'secret-fictif-application-payante', URI = 'https://client.example.test/callback', VERIFIER = 'V'.repeat(43);
const OWNER = 'O'.repeat(43), OTHER = 'X'.repeat(43);

describe('Consentement lié au titulaire, uniquement fictif', () => {
  let folder: string, app: ReturnType<typeof createApp>;
  const query = (change: Record<string, string> = {}) => new URLSearchParams({response_type: 'code', client_id: PAID, redirect_uri: URI,
    code_challenge: pkceChallengeS256(VERIFIER), code_challenge_method: 'S256', scope: 'finma:read tariff:semantic', state: 'état', ...change});
  const get = (base: string, q: URLSearchParams, cookie?: string) => app.request(`${base}${base === MCP ? '/oauth' : '/mcp/oauth'}/authorize?${q}`,
    {headers: {host: new URL(base).host, ...(cookie ? {cookie: `__Host-osd_session=${cookie}`} : {})}});
  const decide = (base: string, q: URLSearchParams, headers: Record<string, string> = {}) => {
    const body = new URLSearchParams(q); body.set('decision', 'allow');
    return app.request(`${base}${base === MCP ? '/oauth' : '/mcp/oauth'}/authorize/decision`,
      {method: 'POST', body, headers: {host: new URL(base).host, 'content-type': 'application/x-www-form-urlencoded', ...headers}});
  };
  const same = (cookie = OWNER) => ({cookie: `__Host-osd_session=${cookie}`, origin: WWW, 'sec-fetch-site': 'same-origin'});
  const codes = () => (getDb().prepare('SELECT COUNT(*) n FROM mcp_oauth_codes').get() as {n: number}).n;

  beforeEach(() => {
    closeDb(); folder = mkdtempSync(join(tmpdir(), 'osd-titulaire-'));
    vi.stubEnv('DATABASE_PATH', join(folder, 'fictive.sqlite')); vi.stubEnv('OAUTH_SIGNING_SECRET', 'cle-fictive-consentement-assez-longue');
    vi.stubEnv('BASE_URL', WWW); vi.stubEnv('NODE_ENV', 'test');
    const db = getDb(), now = Date.now();
    db.prepare("INSERT INTO customers(id,email,created_at) VALUES(1,'titulaire@example.test',?),(2,'autre@example.test',?)").run(now, now);
    for (const [token, id] of [[OWNER, 1], [OTHER, 2]] as const)
      db.prepare("INSERT INTO sessions(purpose,token,customer_id,expires_at,created_at) VALUES('session',?,?,?,?)").run(token, id, now + 86_400_000, now);
    insertClient({client_id: PAID, client_secret_hash: hashToken(SECRET), name: 'Application payante', email: 'titulaire@example.test',
      tier: 'pro', scopes: TIER_DEFAULT_SCOPES.pro, customer_id: 1});
    db.prepare('INSERT INTO mcp_client_redirect_uris(client_id,redirect_uri,created_at) VALUES(?,?,?)').run(PAID, URI, now);
    app = createApp();
  });
  afterEach(() => { closeDb(); vi.unstubAllEnvs(); rmSync(folder, {recursive: true, force: true}); });

  it('reprend une demande payante sur l’hôte du compte, octets de la demande compris', async () => {
    const q = query();
    const r = await get(MCP, q, OWNER);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe(`${WWW}/mcp/oauth/authorize?${q}`);
    expect(codes()).toBe(0);
  });

  it('exige une session, puis celle du titulaire', async () => {
    for (const [cookie, text] of [[undefined, 'Connectez-vous d’abord'], [OTHER, 'n’est pas titulaire']] as const) {
      const r = await get(WWW, query(), cookie);
      expect(r.status).toBe(403); expect(await r.text()).toContain(text);
      expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    }
  });

  it('montre le compte titulaire et transmet l’origine du formulaire', async () => {
    const r = await get(WWW, query(), OWNER);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('Compte titulaire : <strong class="destination">titulaire@example.test</strong>');
    expect(html).toContain('action="/mcp/oauth/authorize/decision"');
    expect(r.headers.get('referrer-policy')).toBe('strict-origin');
  });

  it('refuse un accord payant sans la bonne origine, sur le sous-domaine ou pour un autre compte', async () => {
    const attempts = [
      await decide(WWW, query(), {cookie: `__Host-osd_session=${OWNER}`}),
      await decide(WWW, query(), {...same(), origin: 'https://attaquant.example.test'}),
      await decide(WWW, query(), {...same(), 'sec-fetch-site': 'cross-site'}),
      await decide(WWW, query(), {...same(), origin: 'null'}),
      await decide(MCP, query(), {cookie: `__Host-osd_session=${OWNER}`, origin: MCP}),
      await decide(WWW, query(), same(OTHER)),
      await decide(WWW, query(), {origin: WWW, 'sec-fetch-site': 'same-origin'}),
    ];
    for (const r of attempts) { expect(r.status).toBe(403); expect(await r.json()).toEqual({error: 'holder_required'}); expect(r.headers.get('location')).toBeNull(); }
    expect(codes()).toBe(0);
  });

  it('émet le code payant pour le titulaire connecté, puis un jeton avec cette portée', async () => {
    const r = await decide(WWW, query(), same());
    expect(r.status).toBe(302);
    const location = new URL(r.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(URI); expect(location.searchParams.get('state')).toBe('état');
    const token = await app.request(`${WWW}/mcp/oauth/token`, {method: 'POST', headers: {host: 'www.openswissdata.com', 'content-type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({grant_type: 'authorization_code', client_id: PAID, client_secret: SECRET, code: location.searchParams.get('code')!, code_verifier: VERIFIER, redirect_uri: URI})});
    expect(token.status).toBe(200);
    expect((await token.json()).scope.split(' ').sort()).toEqual(['finma:read', 'tariff:semantic']);
  });

  it('refuse l’accord si la session expire entre l’affichage et la décision', async () => {
    expect((await get(WWW, query(), OWNER)).status).toBe(200);
    getDb().prepare('UPDATE sessions SET expires_at=? WHERE token=?').run(Date.now() - 1, OWNER);
    const r = await decide(WWW, query(), same());
    expect(r.status).toBe(403); expect(codes()).toBe(0);
  });

  it('exige aussi le titulaire pour une application payante qui ne demande que des portées gratuites', async () => {
    const q = query({scope: 'finma:read'});
    const page = await get(MCP, q);
    expect(page.status).toBe(302); expect(page.headers.get('location')).toBe(`${WWW}/mcp/oauth/authorize?${q}`);
    expect((await get(WWW, q)).status).toBe(403);
    for (const r of [await decide(MCP, q), await decide(WWW, q)]) { expect(r.status).toBe(403); expect(r.headers.get('location')).toBeNull(); }
    expect(codes()).toBe(0);
  });

  it('refuse un accord posté depuis le sous-domaine, même avec le cookie du titulaire', async () => {
    const r = await decide(WWW, query(), {...same(), origin: MCP, 'sec-fetch-site': 'same-site'});
    expect(r.status).toBe(403); expect(await r.json()).toEqual({error: 'holder_required'}); expect(codes()).toBe(0);
  });

  it('accepte un refus sans session : il n’accorde rien', async () => {
    const body = new URLSearchParams(query()); body.set('decision', 'deny');
    const r = await app.request(`${MCP}/oauth/authorize/decision`, {method: 'POST', body, headers: {host: 'mcp.openswissdata.com', 'content-type': 'application/x-www-form-urlencoded'}});
    expect(r.status).toBe(302); expect(new URL(r.headers.get('location')!).searchParams.get('error')).toBe('access_denied'); expect(codes()).toBe(0);
  });
});
