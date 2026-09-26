import type {Context,MiddlewareHandler} from 'hono';
import {resolve} from 'node:path';

/** Le fichier effectivement servi décide de la politique, après décodage par le serveur statique. */
export function adminPagePolicy(webRoot:string){
 const admin=resolve(webRoot,'admin/index.html').toLowerCase(),served=new WeakSet<Context>();
 const middleware:MiddlewareHandler=async(c,next)=>{
  await next();
  if(!served.has(c))return;
  const policy=c.res.headers.get('Content-Security-Policy');
  if(!policy)throw new Error('admin_csp_missing');
  if(policy.includes(','))throw new Error('admin_csp_multiple');
  const replace=new Set(['script-src','script-src-elem','script-src-attr','object-src','base-uri','img-src','connect-src','form-action']);
  const retained=policy.split(';').map(value=>value.trim()).filter(value=>value&&!replace.has(value.split(/\s+/,1)[0].toLowerCase()));
  // Exécuté après secureHeaders, qui écrit lui-même ses en-têtes au retour des routes.
  c.header('Content-Security-Policy',[...retained,"script-src 'self'","script-src-elem 'self'","script-src-attr 'none'","object-src 'none'","base-uri 'none'","img-src 'self' data:","connect-src 'self'","form-action 'self'"].join('; '));
  c.header('Cache-Control','private, no-store');
 };
 return {middleware,onFound:(path:string,c:Context)=>{if(resolve(path).toLowerCase()===admin)served.add(c)}};
}
