import {checkAdminBuild} from './check-admin-csp.mjs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Entrée sans garde : un chemin d’appel lié ne doit jamais produire un succès silencieux.
const root=process.argv[2]??join(dirname(fileURLToPath(import.meta.url)),'../web/dist');
const result=await checkAdminBuild(root);
if(result.errors.length){console.error('Bureau : politique de scripts incompatible avec le build : '+[...new Set(result.errors)].join(', '));process.exitCode=1}
else console.log(`Bureau : ${result.scripts.length} script(s) module local avec empreinte, aucun script inline ni gestionnaire HTML.`);
