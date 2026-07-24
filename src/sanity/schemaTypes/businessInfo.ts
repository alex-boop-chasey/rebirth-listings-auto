import { defineArrayMember, defineField, defineType } from 'sanity';

/**
 * Business facts document — the dealer-editable source of truth for Rebi's
 * "knowledge base" (services, location, contact, hours, brands, prose facts).
 *
 * Replaces the placeholder `src/chatbot/knowledge.ts` string as the primary
 * source; `BUSINESS_KNOWLEDGE` stays as a degraded fallback for when no doc
 * exists yet (see src/chatbot/grounding/business-facts.ts).
 *
 * MULTI-TENANT SEAM (DECISION.md Decision 1/2): this is deliberately a plain
 * document, NOT an enforced Studio singleton — a singleton fights the future
 * "one dataset tagged by dealer" model. "The current dealer's" facts are
 * resolved with `*[_type=="businessInfo"][0]` today; when multi-tenant lands, a
 * `dealer` reference field (stubbed in a comment below) scopes it per tenant.
 * Do not add a desk-structure singleton constraint here.
 */
export const businessInfo = defineType({
  name: 'businessInfo',
  title: 'Business info (chatbot knowledge)',
  type: 'document',
  fields: [
    defineField({
      name: 'name',
      title: 'Dealer name',
      type: 'string',
      description: 'Display name of the dealership, e.g. "Bundaberg Motor Group".',
      validation: (Rule) => Rule.required(),
    }),

    // --- Multi-tenant seam (present-but-unused) ---------------------------------
    // When multi-tenant lands, uncomment this reference and scope the business
    // facts lookup to the current dealer (grounding/business-facts.ts). It is left
    // commented rather than active because there is no `dealer` document type yet,
    // and a reference to a missing type would break the Studio schema. Do NOT add
    // a singleton constraint — resolve the current dealer's doc instead.
    // defineField({
    //   name: 'dealer',
    //   title: 'Dealer',
    //   type: 'reference',
    //   to: [{ type: 'dealer' }],
    //   description: 'The tenant this business-info document belongs to.',
    // }),

    defineField({
      name: 'phone',
      title: 'Phone',
      type: 'string',
    }),
    defineField({
      name: 'email',
      title: 'Email',
      type: 'string',
    }),
    defineField({
      name: 'address',
      title: 'Address / location',
      type: 'string',
      description: 'Street address or suburb the visitor should be pointed to.',
    }),
    defineField({
      name: 'established',
      title: 'Established (year)',
      type: 'number',
      description: 'Calendar year the dealership was established, e.g. 1998.',
    }),
    defineField({
      name: 'yearsInBusiness',
      title: 'Years in business',
      type: 'number',
      description:
        'Optional explicit override. If empty, a rough figure is derived from "Established".',
    }),
    defineField({
      name: 'brandsStocked',
      title: 'Brands stocked',
      type: 'array',
      of: [defineArrayMember({ type: 'string' })],
      description: 'Vehicle makes this dealer sells, e.g. Toyota, Ford, Mazda.',
      options: { layout: 'tags' },
    }),
    defineField({
      name: 'openingHours',
      title: 'Opening hours',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'hoursRow',
          fields: [
            defineField({ name: 'day', title: 'Day(s)', type: 'string' }),
            defineField({
              name: 'hours',
              title: 'Hours',
              type: 'string',
              description: 'e.g. "8:30am – 5:30pm" or "Closed".',
            }),
          ],
          preview: { select: { title: 'day', subtitle: 'hours' } },
        }),
      ],
    }),

    // Service toggles + notes. Each is an object so a dealer can turn a service
    // on/off and add a short note the chatbot repeats verbatim.
    ...(['sales', 'finance', 'servicing', 'tradeIns'] as const).map((key) =>
      defineField({
        name: key,
        title:
          key === 'tradeIns'
            ? 'Trade-ins'
            : key.charAt(0).toUpperCase() + key.slice(1),
        type: 'object',
        options: { collapsible: true, collapsed: false },
        fields: [
          defineField({
            name: 'offered',
            title: 'Offered',
            type: 'boolean',
            initialValue: true,
          }),
          defineField({
            name: 'notes',
            title: 'Notes',
            type: 'text',
            rows: 2,
            description: 'Short description the chatbot can use, plain text.',
          }),
        ],
      }),
    ),

    defineField({
      name: 'extraFacts',
      title: 'Extra facts (prose)',
      type: 'array',
      of: [defineArrayMember({ type: 'block' })],
      description:
        'Any other facts the chatbot should know — warranty, T&Cs summary, delivery, etc.',
    }),
  ],
  preview: {
    select: { title: 'name', subtitle: 'address' },
    prepare: ({ title, subtitle }) => ({
      title: title || 'Business info',
      subtitle: subtitle || 'Chatbot knowledge base',
    }),
  },
});
