/** Poids publics figés, empreintes vérifiées avant utilisation. */
import { join } from 'node:path';
import { EMBEDDING_MODEL, EMBEDDING_REVISION, EMBEDDING_FILES, embeddingModelPath } from '../lib/embedding-model.js';
import { prepareModelArtifact } from '../lib/model-artifact.js';
for (const file of EMBEDDING_FILES) {
  await prepareModelArtifact(join(embeddingModelPath,file.name),
    `https://huggingface.co/${EMBEDDING_MODEL}/resolve/${EMBEDDING_REVISION}/${file.name}`,file);
}
console.log(`Recherche : quatre fichiers vérifiés, modèle ${EMBEDDING_REVISION.slice(0,12)}.`);
