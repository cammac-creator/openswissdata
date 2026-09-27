import type {createApp} from '../../src/index.js';

/** Parcours fictif complet : lecture du mail, cookie temporaire, puis clic du formulaire. */
export async function confirmEmailLink(app: ReturnType<typeof createApp>, token: string, extra = ''): Promise<Response> {
  const origin = process.env.BASE_URL ?? 'http://localhost:3000';
  const preview = await app.request(origin + '/api/auth/verify?token=' + token + extra);
  if (preview.status !== 200) return preview;
  const html = await preview.text();
  const confirmation = /name="confirmation" value="([A-Za-z0-9_-]+)"/.exec(html)?.[1];
  if (!confirmation) throw new Error('confirmation_fictive_absente');
  return app.request(origin + '/api/auth/confirm', {method:'POST',
    headers:{origin, cookie:preview.headers.get('set-cookie')!.split(';')[0], 'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({confirmation,decision:'connect'}).toString()});
}
