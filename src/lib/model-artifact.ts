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

/** Un cache de bonne taille ne suffit pas : son empreinte doit également correspondre. */
export async function prepareModelArtifact(path:string,url:string,expected:ModelArtifact):Promise<void> {
  if (!Number.isSafeInteger(expected.size) || expected.size<=0 || !/^[a-f0-9]{64}$/.test(expected.sha256)) {
    throw new Error('Référence de modèle invalide');
  }
  if ((await stat(path).catch(()=>null))?.size===expected.size && await checksum(path)===expected.sha256) return;
  await mkdir(dirname(path),{recursive:true});
  const temp=path+`.${randomUUID()}.part`;
  try {
    const response=await fetch(url,{signal:AbortSignal.timeout(180_000)});
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(`Modèle indisponible : HTTP ${response.status}`); }
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
