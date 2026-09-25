import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { prepareModelArtifact } from '../../src/lib/model-artifact.js';
let dir:string;
const bytes=Buffer.from('modèle public fictif');
const expected={size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
const request=vi.fn();
beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),'osd-model-test-'));vi.stubGlobal('fetch',request);request.mockReset();});
afterEach(async()=>{vi.unstubAllGlobals();await rm(dir,{recursive:true,force:true});});
describe('Intégrité des fichiers de modèles',()=>{
 it('réutilise hors réseau un cache vérifié',async()=>{
  const path=join(dir,'model');await writeFile(path,bytes);
  await prepareModelArtifact(path,'https://example.test/model',expected);
  expect(request).not.toHaveBeenCalled();
 });
 it('remplace un cache altéré même si sa taille est correcte',async()=>{
  const path=join(dir,'model');await writeFile(path,Buffer.alloc(bytes.length,1));
  request.mockResolvedValue(new Response(bytes));
  await prepareModelArtifact(path,'https://example.test/model',expected);
  expect(await readFile(path)).toEqual(bytes);expect(await readdir(dir)).toEqual(['model']);
 });
 for(const [label,body] of [['tronqué',bytes.subarray(0,3)],['trop grand',Buffer.concat([bytes,bytes])],['même taille, mauvaise empreinte',Buffer.alloc(bytes.length,1)]] as const){
  it(`rejette un téléchargement ${label} sans promouvoir le fichier`,async()=>{
   const path=join(dir,'model');request.mockResolvedValue(new Response(body));
   await expect(prepareModelArtifact(path,'https://example.test/model',expected)).rejects.toThrow();
   expect(await readdir(dir)).toEqual([]);
  });
 }
 it('conserve le cache précédent sans le déclarer valable si le réseau échoue',async()=>{
  const path=join(dir,'model');await writeFile(path,'ancien');request.mockResolvedValue(new Response('indisponible',{status:503}));
  await expect(prepareModelArtifact(path,'https://example.test/model',expected)).rejects.toThrow('HTTP 503');
  expect(await readFile(path,'utf8')).toBe('ancien');expect(await readdir(dir)).toEqual(['model']);
 });
 it('nettoie un flux interrompu avant sa fin',async()=>{
  const path=join(dir,'model');let n=0;
  request.mockResolvedValue(new Response(new ReadableStream({pull(controller){if(n++===0)controller.enqueue(bytes.subarray(0,3));else controller.error(new Error('interruption'));}})));
  await expect(prepareModelArtifact(path,'https://example.test/model',expected)).rejects.toThrow('interruption');
  expect(await readdir(dir)).toEqual([]);
 });
 it('refuse une référence invalide avant tout accès réseau',async()=>{
  await expect(prepareModelArtifact(join(dir,'model'),'https://example.test/model',{size:-1,sha256:'x'})).rejects.toThrow('Référence');
  expect(request).not.toHaveBeenCalled();
 });
});
