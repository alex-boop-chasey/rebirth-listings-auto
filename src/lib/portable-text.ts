/**
 * Plain text → Portable Text conversion.
 *
 * Minimal, deliberate: splits on blank lines (a double newline) into paragraphs,
 * and turns each paragraph into a single normal-style block with one span.
 * Nothing fancier — no marks, headings, or lists. Every block and span carries a
 * `_key` because Sanity requires keys on array items, including when this result
 * is patched into a document's `description` field.
 */
import type { PortableTextBlock } from '@portabletext/types';

export function plainTextToPortableText(input: string): PortableTextBlock[] {
  return input
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((paragraph) => ({
      _type: 'block',
      _key: crypto.randomUUID(),
      style: 'normal',
      markDefs: [],
      children: [{ _type: 'span', _key: crypto.randomUUID(), text: paragraph, marks: [] }],
    }));
}
