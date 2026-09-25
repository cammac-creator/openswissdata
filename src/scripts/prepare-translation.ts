/** Téléchargement des poids publics à la construction ; aucun mail n’est transmis à Hugging Face. */
import { mkdir, rename, stat, rm, readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { LANGUAGE_CODES } from '../lib/languages.js';
import { TRANSLATION_MODELS, modelPath } from '../lib/translation-model.js';
const files = ['config.json', 'generation_config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
for (const model of TRANSLATION_MODELS) for (const file of files) {
  const destination = join(modelPath(model.revision), file);
  if ((await stat(destination).catch(() => null))?.size) continue;
  await mkdir(dirname(destination), { recursive: true });
  try {
    const response = await fetch(`https://huggingface.co/${model.name}/resolve/${model.revision}/${file}`, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok || !response.body) throw new Error(`Poids indisponibles : HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(destination + '.part'));
    await rename(destination + '.part', destination);
    console.log(`Traduction : ${file} disponible (${model.revision.slice(0, 7)})`);
  } catch (error) { await rm(destination + '.part', { force: true }); throw error; }
}

const tokenizer = JSON.parse(await readFile(join(modelPath(TRANSLATION_MODELS[0].revision), 'tokenizer.json'), 'utf8')) as {added_tokens:Array<{content:string}>};
const languages = tokenizer.added_tokens.filter(t => /^__[a-z]+__$/.test(t.content)).map(t => t.content.slice(2, -2));
if (languages.length !== LANGUAGE_CODES.length || LANGUAGE_CODES.some(code => !languages.includes(code))) throw new Error('Liste de langues différente des poids livrés');
console.log(`Traduction : ${languages.length} langues vérifiées dans le modèle livré.`);
