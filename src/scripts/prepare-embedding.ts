/** Poids publics figés, écriture temporaire bornée et empreinte vérifiée avant utilisation. */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { EMBEDDING_MODEL, EMBEDDING_REVISION, EMBEDDING_FILES, embeddingModelPath } from '../lib/embedding-model.js';
async function checksum(path:string):Promise<string> {
  const hash=createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
for (const file of EMBEDDING_FILES) {
  const path=join(embeddingModelPath,file.name);
  if ((await stat(path).catch(()=>null))?.size===file.size && await checksum(path)===file.sha256) continue;
  await mkdir(dirname(path),{recursive:true});
  const temp=path+`.${process.pid}.part`;
  try {
    const response=await fetch(`https://huggingface.co/${EMBEDDING_MODEL}/resolve/${EMBEDDING_REVISION}/${file.name}`,{signal:AbortSignal.timeout(180_000)});
    if (!response.ok || !response.body) throw new Error(`Modèle indisponible : HTTP ${response.status}`);
    let size=0;
    const bound=new Transform({transform(chunk,encoding,callback){size+=chunk.length;callback(size>file.size?new Error('Poids plus volumineux que la référence'):null,chunk);}});
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),bound,createWriteStream(temp,{flags:'wx'}));
    if (size!==file.size || await checksum(temp)!==file.sha256) throw new Error('Empreinte du modèle différente de la référence');
    await rename(temp,path);
  } catch(error) {await rm(temp,{force:true});throw error;}
}
console.log(`Recherche : quatre fichiers vérifiés, modèle ${EMBEDDING_REVISION.slice(0,12)}.`);
