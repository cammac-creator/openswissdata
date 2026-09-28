/** Cache des poids publics : contrôle des octets avant promotion, aucun texte utilisateur. */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface ModelArtifact { size:number; sha256:string; }
async function checksum(path:string):Promise<string> {
  const hash=createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

// Refus passagers du fournisseur (un 429 a déjà bloqué une CI) : seuls eux sont repris.
// Un contenu tronqué, trop grand ou d'empreinte différente échoue toujours aussitôt.
const TRANSIENT_STATUS=new Set([408,425,429,500,502,503,504]);
class TransientDownload extends Error {
  constructor(message:string,readonly retryAfterMs:number|null){super(message);}
}
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
function retryAfter(value:string|null):number|null {
  const seconds=value===null||value.trim()===''?NaN:Number(value);
  return Number.isFinite(seconds)&&seconds>=0?Math.min(seconds,60)*1000:null;
}

/** Un cache de bonne taille ne suffit pas : son empreinte doit également correspondre. */
export async function prepareModelArtifact(path:string,url:string,expected:ModelArtifact,
  {attempts=4,wait=pause}:{attempts?:number;wait?:(ms:number)=>Promise<void>}={}):Promise<void> {
  if (!Number.isSafeInteger(expected.size) || expected.size<=0 || !/^[a-f0-9]{64}$/.test(expected.sha256)) {
    throw new Error('Référence de modèle invalide');
  }
  if ((await stat(path).catch(()=>null))?.size===expected.size && await checksum(path)===expected.sha256) return;
  await mkdir(dirname(path),{recursive:true});
  for (let attempt=1;;attempt++) {
    try { return await download(path,url,expected); }
    catch(error) {
      if (!(error instanceof TransientDownload) || attempt>=attempts) throw error;
      // Reprise bornée : 2 s, 4 s, 8 s, ou le délai demandé par le fournisseur (60 s au plus).
      await wait(error.retryAfterMs ?? 2_000*2**(attempt-1));
    }
  }
}

async function download(path:string,url:string,expected:ModelArtifact):Promise<void> {
  const temp=path+`.${randomUUID()}.part`;
  try {
    let response:Response;
    try { response=await fetch(url,{signal:AbortSignal.timeout(180_000)}); }
    catch(error) { throw new TransientDownload(`Modèle injoignable : ${(error as Error).name}`,null); }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      const message=`Modèle indisponible : HTTP ${response.status}`;
      if (TRANSIENT_STATUS.has(response.status)) throw new TransientDownload(message,retryAfter(response.headers.get('retry-after')));
      throw new Error(message);
    }
    let size=0;const hash=createHash('sha256');
    const bound=new Transform({transform(chunk,encoding,callback){
      size+=chunk.length;
      if (size>expected.size) return callback(new Error('Poids plus volumineux que la référence'));
      hash.update(chunk);callback(null,chunk);
    }});
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),bound,createWriteStream(temp,{flags:'wx'}));
    if (size!==expected.size || hash.digest('hex')!==expected.sha256) throw new Error('Empreinte du modèle différente de la référence');
    await rename(temp,path);
  } catch(error) { await rm(temp,{force:true});throw error; }
}
