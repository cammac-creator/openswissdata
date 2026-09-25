import { fileURLToPath } from 'node:url';
export const TRANSLATION_MODELS = [
  { name:'Xenova/m2m100_418M', revision:'9c374f0b7aca709787cea97b047bfbbd1559d177' },
  { name:'Xenova/opus-mt-en-fr', revision:'28726206f80896b90035bd99cccd5cc1e151f916' },
] as const;
export const modelPath = (revision:string) => fileURLToPath(new URL(`../../dist/models/translation/${revision}/`, import.meta.url));
export const translationModelPath = (language:string) => modelPath(TRANSLATION_MODELS[language === 'en' ? 1 : 0].revision);
