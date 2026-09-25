import {it,expect,vi,afterEach} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateTaresEmbeddings,TARES_EMBEDDING_MODEL,TARES_EMBEDDING_MODEL_VERSION} from '../../etl/tares/embeddings.js';
import {generateNogaEmbeddings,NOGA_EMBEDDING_MODEL,NOGA_EMBEDDING_MODEL_VERSION} from '../../etl/classifications/embeddings.js';
const mocks=vi.hoisted(()=>({factory:vi.fn(),extractor:vi.fn()}));
vi.mock('../../src/lib/embedding-model.js',async original=>({...await original<typeof import('../../src/lib/embedding-model.js')>(),createEmbeddingExtractor:mocks.factory}));
const dirs:string[]=[];
afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});vi.resetAllMocks();});
for(const dataset of ['tares','noga'] as const){
 for(const outdated of [true,false]){
  it(`${dataset} : ${outdated?'recalcule un cache produit par un ancien moteur':'reprend le cache courant sans charger le modèle'}`,async()=>{
   const dir=mkdtempSync(join(tmpdir(),'osd-cache-model-'));dirs.push(dir);const cachePath=join(dir,'cache.json');
   const model=dataset==='tares'?TARES_EMBEDDING_MODEL:NOGA_EMBEDDING_MODEL;
   const version=dataset==='tares'?TARES_EMBEDDING_MODEL_VERSION:NOGA_EMBEDDING_MODEL_VERSION;
   writeFileSync(cachePath,JSON.stringify({model,model_version:outdated?'ancien-moteur':version,dimensions:768,entries:{'0101:fr':Array(768).fill(.1)}}));
   mocks.extractor.mockResolvedValue({data:new Float32Array(768).fill(.25)});mocks.factory.mockResolvedValue(mocks.extractor);
   const row={hs8:'0101',code:'0101',scheme:'NOGA_2025',designation_fr:'Texte fictif',label_fr:'Texte fictif'};
   const fn=dataset==='tares'?generateTaresEmbeddings:generateNogaEmbeddings;
   const result=await fn([row] as any,{cachePath,langs:['fr'],log:()=>{}});
   expect(result).toHaveLength(1);expect(result[0].model_version).toBe(version);
   expect(result[0].embedding[0]).toBe(outdated ? .25 : .1);
   expect(mocks.factory).toHaveBeenCalledTimes(outdated?1:0);
   expect(mocks.extractor).toHaveBeenCalledTimes(outdated?1:0);
  });
 }
}
