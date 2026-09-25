/** Téléchargement des poids publics à la construction ; aucun mail n’est transmis à Hugging Face. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LANGUAGE_CODES } from '../lib/languages.js';
import { TRANSLATION_MODELS, modelPath } from '../lib/translation-model.js';
import { prepareModelArtifact } from '../lib/model-artifact.js';
for (const model of TRANSLATION_MODELS) for (const file of model.files) {
  await prepareModelArtifact(join(modelPath(model.revision), file.name),
    `https://huggingface.co/${model.name}/resolve/${model.revision}/${file.name}`, file);
}
console.log('Traduction : douze fichiers vérifiés par taille et SHA-256.');

const tokenizer = JSON.parse(await readFile(join(modelPath(TRANSLATION_MODELS[0].revision), 'tokenizer.json'), 'utf8')) as {added_tokens:Array<{content:string}>};
const languages = tokenizer.added_tokens.filter(t => /^__[a-z]+__$/.test(t.content)).map(t => t.content.slice(2, -2));
if (languages.length !== LANGUAGE_CODES.length || LANGUAGE_CODES.some(code => !languages.includes(code))) throw new Error('Liste de langues différente des poids livrés');
console.log(`Traduction : ${languages.length} langues vérifiées dans le modèle livré.`);
