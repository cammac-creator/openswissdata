import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import * as data from '../../src/mcp/data-loader.js';
import * as embedder from '../../src/mcp/embedder.js';
import {classifyTextHandler} from '../../src/mcp/tools/classify-text.js';
import {tariffSemanticSearchHandler} from '../../src/mcp/tools/tariff-semantic-search.js';

describe('Erreurs sémantiques sans détail interne ni téléchargement',()=>{
 beforeEach(()=>{vi.spyOn(data,'getNogaEmbeddings').mockResolvedValue([]);vi.spyOn(data,'getTaresEmbeddings').mockResolvedValue([]);vi.spyOn(embedder,'embedQuery').mockResolvedValue(new Float32Array(768))});
 afterEach(()=>vi.restoreAllMocks());
 const expected={content:[{type:'text',text:'Recherche sémantique temporairement indisponible.'}],isError:true};
 const fault=new Error('Chemin interne fictif /donnees/privees et URL https://example.test/?token=secret-fictif');
 it.each(['classifications','tarifs'])('un index absent ou illisible reste une erreur fermée : %s',async type=>{
  if(type==='classifications'){vi.mocked(data.getNogaEmbeddings).mockRejectedValue(fault);expect(await classifyTextHandler({text:'Entreprise fictive'})).toEqual(expected)}
  else{vi.mocked(data.getTaresEmbeddings).mockRejectedValue(fault);expect(await tariffSemanticSearchHandler({query:'Produit fictif'})).toEqual(expected)}
 });
 it.each(['classifications','tarifs'])('une erreur synchrone du chargeur reste fermée : %s',async type=>{
  if(type==='classifications'){vi.mocked(data.getNogaEmbeddings).mockImplementation(()=>{throw fault});expect(await classifyTextHandler({text:'Entreprise fictive'})).toEqual(expected)}
  else{vi.mocked(data.getTaresEmbeddings).mockImplementation(()=>{throw fault});expect(await tariffSemanticSearchHandler({query:'Produit fictif'})).toEqual(expected)}
 });
 it.each(['classifications','tarifs'])('le moteur de texte ne révèle pas son diagnostic : %s',async type=>{
  vi.mocked(embedder.embedQuery).mockRejectedValue(fault);const result=type==='classifications'?await classifyTextHandler({text:'Entreprise fictive'}):await tariffSemanticSearchHandler({query:'Produit fictif'});expect(result).toEqual(expected);
 });
 it('un journal en panne ne remplace pas l’erreur métier fermée',async()=>{
  vi.spyOn(Date,'now').mockReturnValue(Date.now()+120_000);const warn=vi.spyOn(console,'warn').mockImplementation(()=>{throw fault});vi.mocked(data.getNogaEmbeddings).mockRejectedValue(fault);
  expect(await classifyTextHandler({text:'Entreprise fictive'})).toEqual(expected);expect(warn).toHaveBeenCalledTimes(1);expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-fictif');
 });
});
