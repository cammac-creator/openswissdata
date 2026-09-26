import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,symlink,link,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectAdminHtml,checkAdminBuild} from '../../scripts/check-admin-csp.mjs';
const valid='<script type="module" src="/_astro/admin.CYTGuVio.js"></script>';
describe('Artefact compatible avec la politique du bureau',()=>{
 it('accepte un module local identifié et ignore les exemples dans les commentaires',()=>{expect(inspectAdminHtml('<!--<script>exemple()</script>-->'+valid)).toEqual({errors:[],scripts:['/_astro/admin.CYTGuVio.js']})});
 it.each([
  ['<script>alert(1)</script>','script_non_module_local_avec_empreinte'],
  ['<script src="/_astro/admin.CYTGuVio.js"></script>','script_non_module_local_avec_empreinte'],
  ['<script type="module" src="https://tiers.example.test/fichier.js"></script>','script_non_module_local_avec_empreinte'],
  ['<script type="module" src="//tiers.example.test/fichier.js"></script>','script_non_module_local_avec_empreinte'],
  ['<script type="module" src="/_astro/admin.js"></script>','script_non_module_local_avec_empreinte'],
  [valid.replace('</script>','alert(1)</script>'),'contenu_script_inline'],
  ['<button onClick=action()>Action</button>'+valid,'gestionnaire_html_inline'],
  ['<a href="java&#x73;cript:action()">Action</a>'+valid,'url_javascript'],
  ['<a href="java&#10;script:action()">Action</a>'+valid,'url_javascript'],
  ['<iframe srcdoc="&lt;script&gt;action()&lt;/script&gt;"></iframe>'+valid,'document_inline'],
 ])('refuse un artefact incompatible : %s', (html,error)=>{expect(inspectAdminHtml(html).errors).toContain(error)});
 it('refuse un bureau sans son script',()=>{expect(inspectAdminHtml('<p>Fictif</p>').errors).toContain('script_du_bureau_absent')});
 it('vérifie les ressources réelles et refuse une absence ou un lien symbolique',async()=>{
  const root=await mkdtemp(join(tmpdir(),'osd-csp-build-'));try{
   await mkdir(join(root,'admin'));await mkdir(join(root,'_astro'));await writeFile(join(root,'admin/index.html'),valid);
   expect((await checkAdminBuild(root)).errors).toContain('ressource_absente_ou_liee');
   await writeFile(join(root,'_astro/admin.CYTGuVio.js'),'export{}');expect((await checkAdminBuild(root)).errors).toEqual([]);
   await rm(join(root,'_astro/admin.CYTGuVio.js'));await writeFile(join(root,'externe.js'),'export{}');await symlink(join(root,'externe.js'),join(root,'_astro/admin.CYTGuVio.js'));expect((await checkAdminBuild(root)).errors).toContain('ressource_absente_ou_liee');
  }finally{await rm(root,{recursive:true,force:true})}
 });
 it('refuse une nouvelle sous-page du bureau ou une seconde adresse liée au même HTML',async()=>{
  const root=await mkdtemp(join(tmpdir(),'osd-csp-pages-'));try{
   await mkdir(join(root,'admin/login'),{recursive:true});await mkdir(join(root,'_astro'));await writeFile(join(root,'admin/index.html'),valid);await writeFile(join(root,'_astro/admin.CYTGuVio.js'),'export{}');
   await writeFile(join(root,'admin/login/index.html'),valid);expect((await checkAdminBuild(root)).errors).toContain('page_bureau_supplementaire');await rm(join(root,'admin/login/index.html'));
   await link(join(root,'admin/index.html'),join(root,'alias.html'));expect((await checkAdminBuild(root)).errors).toContain('page_bureau_liee');
  }finally{await rm(root,{recursive:true,force:true})}
 });
 it('refuse aussi un répertoire admin lié ailleurs',async()=>{
  const root=await mkdtemp(join(tmpdir(),'osd-csp-dir-'));try{
   await mkdir(join(root,'admin'));await mkdir(join(root,'_astro'));await writeFile(join(root,'admin/index.html'),valid);await writeFile(join(root,'_astro/admin.CYTGuVio.js'),'export{}');
   await rename(join(root,'admin'),join(root,'autre'));await symlink(join(root,'autre'),join(root,'admin'));
   expect((await checkAdminBuild(root)).errors).toContain('page_bureau_liee');
  }finally{await rm(root,{recursive:true,force:true})}
 });

 it('refuse un alias symbolique extérieur ou une autre page important le bureau',async()=>{
  const root=await mkdtemp(join(tmpdir(),'osd-csp-alias-'));try{
   await mkdir(join(root,'admin'));await mkdir(join(root,'_astro'));await writeFile(join(root,'admin/index.html'),valid);await writeFile(join(root,'_astro/admin.CYTGuVio.js'),'export{}');
   await symlink(join(root,'admin/index.html'),join(root,'alias.html'));expect((await checkAdminBuild(root)).errors).toContain('artefact_lie');await rm(join(root,'alias.html'));
   await writeFile(join(root,'alias.html'),valid);expect((await checkAdminBuild(root)).errors).toContain('module_bureau_hors_page');
  }finally{await rm(root,{recursive:true,force:true})}
 });
 it('la CLI appelée par un lien contrôle réellement la page et échoue sur un script inline',async()=>{
  const root=await mkdtemp(join(tmpdir(),'osd-csp-cli-'));try{
   await mkdir(join(root,'site/admin'),{recursive:true});await mkdir(join(root,'site/_astro'));await writeFile(join(root,'site/admin/index.html'),valid);await writeFile(join(root,'site/_astro/admin.CYTGuVio.js'),'export{}');
   const cli=join(root,'controle.mjs');await symlink(fileURLToPath(new URL('../../scripts/check-admin-csp-cli.mjs',import.meta.url)),cli);
   const run=()=>spawnSync(process.execPath,[cli,join(root,'site')],{encoding:'utf8',timeout:10000});
   const success=run();expect(success.status).toBe(0);expect(success.stdout).toContain('Bureau : 1 script(s)');
   await writeFile(join(root,'site/admin/index.html'),valid+'<script>exemple()</script>');const failure=run();expect(failure.status).toBe(1);expect(failure.stderr).toContain('contenu_script_inline');
  }finally{await rm(root,{recursive:true,force:true})}
 });

});
