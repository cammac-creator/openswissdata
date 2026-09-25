/** Un même modèle figé pour les index et les requêtes ; aucun téléchargement à l’exécution. */
import { fileURLToPath } from 'node:url';
export const EMBEDDING_MODEL = 'Xenova/paraphrase-multilingual-mpnet-base-v2';
export const EMBEDDING_REVISION = 'e5d116277351513fd260955ece953ecddde7046e';
export const EMBEDDING_FILES = [
  { name:'config.json', size:751, sha256:'14533f158fb2476510b3a83256386b983daa8cfa799ea35217c89947be63835e' },
  { name:'tokenizer_config.json', size:418, sha256:'efb5c0d09722e5fe59a462cd2a9976ee216d55b037597d997cd3fe833216da15' },
  { name:'tokenizer.json', size:17082913, sha256:'b60b6b43406a48bf3638526314f3d232d97058bc93472ff2de930d43686fa441' },
  { name:'onnx/model_quantized.onnx', size:278647663, sha256:'280b5fe103cc79d891d672f47826067835b7feed8b0b1865e34ed38f21719b49' },
] as const;
export const embeddingModelPath = fileURLToPath(new URL(`../../dist/models/embedding/${EMBEDDING_REVISION}/`, import.meta.url));
export async function createEmbeddingExtractor() {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  return pipeline('feature-extraction', embeddingModelPath, {
    local_files_only:true, dtype:'q8', device:'cpu',
    session_options:{intraOpNumThreads:2,interOpNumThreads:1,logSeverityLevel:3},
  });
}
