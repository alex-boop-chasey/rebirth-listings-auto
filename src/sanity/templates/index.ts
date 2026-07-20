import type { Template } from 'sanity';
import { automotiveListingTemplate } from './automotive';

// The automotive listing creation template, registered alongside Sanity's defaults.
export const listingTemplates: Template[] = [
  automotiveListingTemplate,
];
