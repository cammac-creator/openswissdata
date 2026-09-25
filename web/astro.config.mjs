// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.openswissdata.com',
  i18n: {
    defaultLocale: 'fr',
    locales: ['fr', 'de', 'en'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
  vite: {
    plugins: [tailwindcss()]
  },
  integrations: [
    sitemap({
      filter: (page) => {
        const path = new URL(page).pathname.replace(/^\/(de|en)(?=\/|$)/, '');
        return !/^\/(account|famille|admin|404)(\/|\.html|$)/.test(path) && !path.endsWith('.json');
      },
      // Une date de build ne décrit pas la dernière modification du contenu.
      // Omettre lastmod tant qu'une date significative par page n'est pas disponible.
      i18n: {
        defaultLocale: 'fr',
        locales: { fr: 'fr-CH', de: 'de-CH', en: 'en' },
      },
    }),
  ],
});
