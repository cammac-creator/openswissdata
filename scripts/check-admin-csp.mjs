/** Contrôle de l’artefact construit, pas un assainisseur de HTML provenant d’un utilisateur. */
import {Parser} from 'htmlparser2';
import {readFile,lstat,realpath,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';

export function inspectAdminHtml(html){
 const errors=new Set(),scripts=[];let inScript=false;
 const parser=new Parser({
  onopentag(name,attrs){
   if(name==='script'){
    inScript=true;
    if(attrs.type!=='module'||!/^\/_astro\/[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]{8,}\.js$/.test(attrs.src??''))errors.add('script_non_module_local_avec_empreinte');
    else scripts.push(attrs.src);
   }
  },
  onattribute(name,value){
   if(/^on[a-z]/i.test(name))errors.add('gestionnaire_html_inline');
   if(/^(?:href|src|action|formaction|xlink:href)$/i.test(name)&&/^javascript:/i.test(value.replace(/[\u0000-\u0020]/g,'')))errors.add('url_javascript');
   if(name==='srcdoc')errors.add('document_inline');
  },
  ontext(text){if(inScript&&text.trim())errors.add('contenu_script_inline')},
  onclosetag(name){if(name==='script')inScript=false},
 },{decodeEntities:true,lowerCaseTags:true,lowerCaseAttributeNames:true});
 parser.end(html);if(!scripts.length)errors.add('script_du_bureau_absent');
 return {errors:[...errors],scripts};
}

export async function checkAdminBuild(root){
 const html=await readFile(join(root,'admin/index.html'),'utf8'),result=inspectAdminHtml(html);
 const expectedRoot=await realpath(root);
 const page=await lstat(join(root,'admin/index.html'));
 if(!page.isFile()||page.nlink!==1||await realpath(join(root,'admin/index.html'))!==join(expectedRoot,'admin/index.html'))result.errors.push('page_bureau_liee');
 const inspectDirectory=async(dir)=>{
  for(const entry of await readdir(dir,{withFileTypes:true})){
   const path=join(dir,entry.name);
   if(entry.isSymbolicLink())result.errors.push('page_bureau_liee');
   else if(entry.isDirectory())await inspectDirectory(path);
   else if(entry.name.toLowerCase().endsWith('.html')&&resolve(path)!==resolve(root,'admin/index.html'))result.errors.push('page_bureau_supplementaire');
  }
 };
 await inspectDirectory(join(root,'admin'));
 // Le bureau ne doit pas réapparaître sous une adresse avec la politique publique.
 const inspectAliases=async(dir)=>{
  for(const entry of await readdir(dir,{withFileTypes:true})){
   const path=join(dir,entry.name);
   if(entry.isSymbolicLink())result.errors.push('artefact_lie');
   else if(entry.isDirectory())await inspectAliases(path);
   else if(entry.name.toLowerCase().endsWith('.html')&&resolve(path)!==resolve(root,'admin/index.html')){
    const content=await readFile(path,'utf8');
    if(result.scripts.some(source=>content.includes(source)))result.errors.push('module_bureau_hors_page');
   }
  }
 };
 await inspectAliases(root);
 for(const source of result.scripts){
  const path=join(root,source);
  try{const info=await lstat(path);if(!info.isFile()||await realpath(path)!==join(expectedRoot,source))result.errors.push('ressource_absente_ou_liee')}
  catch{result.errors.push('ressource_absente_ou_liee')}
 }
 return result;
}
