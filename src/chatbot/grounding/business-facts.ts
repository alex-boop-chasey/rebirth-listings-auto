/**
 * Business facts grounding — the dealer-editable "knowledge base".
 * ------------------------------------------------------------------
 * Fetches the current dealer's `businessInfo` document via the PUBLIC Sanity
 * client (no token — see src/sanity/lib/client.ts) and renders it to the plain
 * text the system prompt expects. When the document is absent or the fetch
 * fails, it degrades to the static `BUSINESS_KNOWLEDGE` string (knowledge.ts is
 * demoted from source-of-truth to fallback, not deleted).
 *
 * `dealerNotes` is a LISTING field and is never touched here; this module only
 * reads the businessInfo document, which has no private fields.
 */
import { client } from '../../sanity/lib/client';
import { getDealerConfig } from '../../config/dealer';
import { BUSINESS_KNOWLEDGE } from '../knowledge';
import { cachedText } from './cache';
import type { KVNamespaceLike } from '../core';

/** Minimal Portable Text shape we read (spans → text). */
interface PtSpan {
  _type?: string;
  text?: string;
}
interface PtBlock {
  _type?: string;
  children?: PtSpan[];
}

interface ServiceInfo {
  offered?: boolean;
  notes?: string;
}

interface BusinessInfoDoc {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  established?: number;
  yearsInBusiness?: number;
  brandsStocked?: string[];
  openingHours?: Array<{ day?: string; hours?: string }>;
  sales?: ServiceInfo;
  finance?: ServiceInfo;
  servicing?: ServiceInfo;
  tradeIns?: ServiceInfo;
  extraFacts?: PtBlock[];
}

const PROJECTION = `{
  name, phone, email, address, established, yearsInBusiness,
  brandsStocked,
  openingHours[]{ day, hours },
  sales, finance, servicing, tradeIns,
  extraFacts
}`;

/** Flatten Portable Text blocks to plain paragraphs. */
function portableTextToPlain(blocks: PtBlock[] | undefined): string {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .map((b) => (b.children ?? []).map((c) => c.text ?? '').join(''))
    .map((p) => p.trim())
    .filter(Boolean)
    .join('\n\n');
}

function renderService(label: string, s: ServiceInfo | undefined): string | null {
  if (!s || s.offered === false) return null;
  const note = s.notes?.trim();
  return note ? `${label}: ${note}` : `${label}: offered.`;
}

/** Render a businessInfo document to the plain-text knowledge-base shape. */
function renderBusinessFacts(doc: BusinessInfoDoc): string {
  const name = doc.name?.trim() || 'this dealership';
  const lines: string[] = [];

  // About
  const about: string[] = [`# ABOUT ${name.toUpperCase()}`, ''];
  let intro = `${name} is a local car dealership.`;
  const years =
    doc.yearsInBusiness ??
    (doc.established ? new Date().getFullYear() - doc.established : undefined);
  if (doc.established) intro += ` Established ${doc.established}.`;
  if (typeof years === 'number' && years > 0) {
    intro += ` Around ${years} years in business.`;
  }
  about.push(intro);
  if (doc.brandsStocked?.length) {
    about.push(`Brands stocked: ${doc.brandsStocked.join(', ')}.`);
  }
  lines.push(about.join('\n'));

  // Services
  const services = [
    renderService('Sales', doc.sales),
    renderService('Financing', doc.finance),
    renderService('Service department', doc.servicing),
    renderService('Trade-ins', doc.tradeIns),
  ].filter(Boolean) as string[];
  if (services.length) {
    lines.push(['# WHAT WE DO (SERVICES)', '', ...services].join('\n'));
  }

  // Opening hours
  const hours = (doc.openingHours ?? [])
    .filter((h) => h?.day)
    .map((h) => `- ${h.day}: ${h.hours ?? ''}`.trimEnd());
  if (hours.length) {
    lines.push(['# OPENING HOURS', '', ...hours].join('\n'));
  }

  // Contact
  const contact: string[] = ['# CONTACT', ''];
  if (doc.phone) contact.push(`- Phone: ${doc.phone}`);
  if (doc.email) contact.push(`- Email: ${doc.email}`);
  if (doc.address) contact.push(`- Address: ${doc.address}`);
  contact.push('- You can also leave your details in this chat and we’ll follow up.');
  lines.push(contact.join('\n'));

  // Extra prose facts
  const extra = portableTextToPlain(doc.extraFacts);
  if (extra) lines.push(['# MORE', '', extra].join('\n'));

  return lines.join('\n\n');
}

/**
 * Resolve the current dealer's business facts as plain text. KV TTL-cached when
 * `kv` is bound. Always returns a usable string — on absence or any error it
 * falls back to the static `BUSINESS_KNOWLEDGE`.
 */
export async function getBusinessFacts(kv?: KVNamespaceLike): Promise<string> {
  const cfg = getDealerConfig().chat.grounding;
  const type = cfg.businessInfoType;
  try {
    return await cachedText(kv, `grounding:business:v1:${type}`, cfg.cacheTtlSeconds.businessFacts, async () => {
      // Current dealer's doc. `[0]` = "the one doc today"; a dealer reference
      // filter drops in here when multi-tenant lands (see the schema comment).
      const doc = await client.fetch<BusinessInfoDoc | null>(
        `*[_type == $type][0]${PROJECTION}`,
        { type },
      );
      if (!doc || !doc.name) return BUSINESS_KNOWLEDGE;
      return renderBusinessFacts(doc);
    });
  } catch (err) {
    console.error('[grounding] Business facts fetch failed (using static fallback)', err);
    return BUSINESS_KNOWLEDGE;
  }
}
