import type { SchemaTypeDefinition } from 'sanity';
import { listing } from './listing';
import { businessInfo } from './businessInfo';

export const schemaTypes: SchemaTypeDefinition[] = [listing, businessInfo];
