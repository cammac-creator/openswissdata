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
      filter: (page) =>
        !page.includes('/account') &&
        !page.includes('/famille') &&
        !page.includes('/admin'),
      changefreq: 'weekly',
      priority: 0.7,
      lastmod: new Date(),
      i18n: {
        defaultLocale: 'fr',
        locales: { fr: 'fr-CH', de: 'de-CH', en: 'en' },
      },
    }),
  ],
});
