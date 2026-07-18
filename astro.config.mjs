// @ts-check
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';

import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';
import sanity from '@sanity/astro';
import sitemap from '@astrojs/sitemap';

import cloudflare from '@astrojs/cloudflare';

// astro.config is loaded before .env is processed, so read env vars explicitly.
const { PUBLIC_SANITY_PROJECT_ID, PUBLIC_SANITY_DATASET, PUBLIC_SANITY_API_VERSION } =
  loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), '');

// https://astro.build/config
export default defineConfig({
  // Placeholder public URL — swap for the real domain when the demo is deployed.
  site: 'https://astro-listings-pro-demo.pages.dev',

  integrations: [
    sanity({
      projectId: PUBLIC_SANITY_PROJECT_ID,
      dataset: PUBLIC_SANITY_DATASET,
      apiVersion: PUBLIC_SANITY_API_VERSION ?? '2024-01-01',
      useCdn: false,
      // Sanity Studio is embedded at this route
      studioBasePath: '/studio',
    }),
    react(),
    // Exclude the embedded Studio admin and the 404 page from the sitemap.
    sitemap({ filter: (page) => !page.includes('/studio') && !page.includes('/404') }),
  ],

  vite: {
    plugins: [tailwindcss()],
  },

  adapter: cloudflare(),
});