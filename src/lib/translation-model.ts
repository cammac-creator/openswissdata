import { fileURLToPath } from 'node:url';
// Empreintes vérifiées contre les objets des révisions officielles le 25.09.2026.
export const TRANSLATION_MODELS = [
  {
    "name": "Xenova/m2m100_418M",
    "revision": "9c374f0b7aca709787cea97b047bfbbd1559d177",
    "files": [
      {
        "name": "config.json",
        "size": 908,
        "sha256": "1dbdf77ddc7809acd4c54ccf0eab46f840b40174afb1b6f6de8787244e832938"
      },
      {
        "name": "generation_config.json",
        "size": 233,
        "sha256": "722210dd0bee7bef4e8e7f9a8574d8c56a2dfff723d73f390ce67892740b9009"
      },
      {
        "name": "tokenizer.json",
        "size": 7988527,
        "sha256": "03d9e111731c2d71f39a2c2a88499743e4c251385d07f0384b4349a23ba54363"
      },
      {
        "name": "tokenizer_config.json",
        "size": 1813,
        "sha256": "bacfd4b9da25a61e01f17abe660465f616c9a1a3f5e23ab9ad3326c3788f2d9f"
      },
      {
        "name": "onnx/encoder_model_quantized.onnx",
        "size": 287856370,
        "sha256": "13a94e354a9140764eb81102d77d3ec6952d796e6f113c651eeb3c3443da0386"
      },
      {
        "name": "onnx/decoder_model_merged_quantized.onnx",
        "size": 344128178,
        "sha256": "007654bcabb6cea6fd3bde34ce933137b431330b3755781145d7b6906270b45a"
      }
    ]
  },
  {
    "name": "Xenova/opus-mt-en-fr",
    "revision": "28726206f80896b90035bd99cccd5cc1e151f916",
    "files": [
      {
        "name": "config.json",
        "size": 1411,
        "sha256": "b522b73fcc86f77981349c1df2a2e041eed0dbcbea4acf2635019cf21d51ffc0"
      },
      {
        "name": "generation_config.json",
        "size": 293,
        "sha256": "f9a4824ec78c61b4a95afc43bbb6a9545a44ccf1c01d0963a286e799b9e7b256"
      },
      {
        "name": "tokenizer.json",
        "size": 5637839,
        "sha256": "8391785c1a2139e7af4678571ccd8dc654ecbb72e4be186940f65d7c604f0246"
      },
      {
        "name": "tokenizer_config.json",
        "size": 280,
        "sha256": "eb8dfaa142fe03627c8d035415f56c46284b6ee4a16e54c6e8236928ac5a1170"
      },
      {
        "name": "onnx/encoder_model_quantized.onnx",
        "size": 50090398,
        "sha256": "0a81bdba62f53223740a8c6c6f58e716eba8ea1f92dfa569caf27ed5e3b6a0f7"
      },
      {
        "name": "onnx/decoder_model_merged_quantized.onnx",
        "size": 57381512,
        "sha256": "333b244bce16023df04541c8cf9fd60aec9b0569da393c4b831d561897b0bda8"
      }
    ]
  }
] as const;
export const modelPath = (revision:string) => fileURLToPath(new URL(`../../dist/models/translation/${revision}/`, import.meta.url));
export const translationModelPath = (language:string) => modelPath(TRANSLATION_MODELS[language === 'en' ? 1 : 0].revision);
