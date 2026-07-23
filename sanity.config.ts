import { defineConfig } from 'sanity';
import { structureTool } from 'sanity/structure';
import { schemaTypes } from './src/sanity/schemaTypes';
import { listingTemplates } from './src/sanity/templates';
import { generateDescriptionAction } from './src/sanity/actions/generateDescription';

export default defineConfig({
  name: 'default',
  title: 'astro-listings-demo',
  projectId: import.meta.env.PUBLIC_SANITY_PROJECT_ID,
  dataset: import.meta.env.PUBLIC_SANITY_DATASET,
  plugins: [structureTool()],
  schema: {
    types: schemaTypes,
    // Append the listing templates to Sanity's auto-generated defaults so the
    // blank "Listing" create option survives alongside the two presets.
    templates: (prev) => [...prev, ...listingTemplates],
  },
  document: {
    // Add the "Generate description" action to the listing document only,
    // alongside Sanity's built-in actions (publish, delete, …).
    actions: (prev, context) =>
      context.schemaType === 'listing' ? [...prev, generateDescriptionAction] : prev,
  },
});
