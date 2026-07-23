import { defineArrayMember, defineField, defineType } from 'sanity';

/**
 * Core listing document (automotive).
 *
 * The `details` key/value array lets a listing attach arbitrary extra
 * attributes without schema migrations, while `defineType`/`defineField` keep
 * the typed spec fields type-safe and non-breaking.
 */
export const listing = defineType({
  name: 'listing',
  title: 'Listing',
  type: 'document',
  fields: [
    // Core fields — required/shared across every listing type.
    defineField({
      name: 'title',
      title: 'Title',
      type: 'string',
      description: 'The listing name.',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      description: 'Auto-generated from the title.',
      options: { source: 'title', maxLength: 96 },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'description',
      title: 'Description',
      type: 'array',
      description: 'Rich text description.',
      of: [defineArrayMember({ type: 'block' })],
    }),
    // Private dealer shorthand — NEVER shown to buyers. Deliberately not added to
    // LISTING_FIELDS (src/lib/listing.ts), so it stays server-side. Feeds the AI
    // description generator, and (future) search/chat grounding. Persistent:
    // survives description regeneration.
    defineField({
      name: 'dealerNotes',
      title: 'Dealer notes (for AI)',
      type: 'text',
      rows: 4,
      description:
        "Rough shorthand like 'one owner, full service history, tow bar, no accidents'. " +
        'Not shown to buyers directly. Used by AI description generator, search, and chat.',
    }),
    defineField({
      name: 'price',
      title: 'Price',
      type: 'number',
      description: 'Listed price.',
      validation: (Rule) => Rule.required().min(0),
    }),
    defineField({
      name: 'currency',
      title: 'Currency',
      type: 'string',
      options: { list: ['AUD', 'USD', 'GBP', 'EUR', 'NZD'] },
      initialValue: 'AUD',
    }),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      options: { list: ['active', 'sold', 'pending', 'draft'], layout: 'radio' },
      initialValue: 'active',
    }),
    defineField({
      name: 'images',
      title: 'Images',
      type: 'array',
      description: 'Multiple images supported. The first image is used as the hero/thumbnail.',
      of: [defineArrayMember({ type: 'image', options: { hotspot: true } })],
    }),
    defineField({
      name: 'category',
      title: 'Category',
      type: 'string',
      description: 'Fixed to "automotive" — this is an automotive-only dataset.',
      initialValue: 'automotive',
      readOnly: true,
      hidden: true,
    }),

    // Extensible key/value metadata. Supports text, number, boolean and date types
    // so values can be sorted/filtered (e.g. odometer, service history) while
    // remaining flexible enough for arbitrary extra details (sunroof, tow pack, …).
    defineField({
      name: 'details',
      title: 'Details',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'detail',
          fields: [
            defineField({
              name: 'label',
              title: 'Label',
              type: 'string',
              description: 'e.g. "Odometer", "Year", "Condition", "Bedrooms".',
              validation: (Rule) => Rule.required(),
            }),
            defineField({
              name: 'value',
              title: 'Value (display)',
              type: 'string',
              description:
                'Human-readable display override, e.g. "142,000 km", "2019", "Good". ' +
                'For number values this can be derived from Value (number) + Unit, but an ' +
                'explicit value allows custom formatting.',
            }),
            defineField({
              name: 'valueType',
              title: 'Value type',
              type: 'string',
              description: 'How the value should be interpreted (drives sorting/filtering).',
              options: { list: ['text', 'number', 'boolean', 'date'], layout: 'radio' },
              initialValue: 'text',
            }),
            defineField({
              name: 'valueNumber',
              title: 'Value (number)',
              type: 'number',
              description:
                'Used when Value type is "number" (e.g. odometer 142000, bedrooms 3, ' +
                'year 2019). Kept separate from the display value for sorting and filtering.',
            }),
            defineField({
              name: 'unit',
              title: 'Unit',
              type: 'string',
              description:
                'Optional display unit for number values (e.g. "km", "miles", "sqm", "acres").',
            }),
            defineField({
              name: 'valueBoolean',
              title: 'Value (boolean)',
              type: 'boolean',
              description: 'Used when Value type is "boolean" (e.g. "Has Pool", "Pet Friendly").',
            }),
            defineField({
              name: 'valueDate',
              title: 'Value (date)',
              type: 'string',
              description: 'ISO date string, used when Value type is "date".',
            }),
          ],
          preview: {
            select: { title: 'label', subtitle: 'value' },
          },
        }),
      ],
    }),

    // Typed automotive spec fields. Unlike the free-form `details` array above,
    // these are first-class enums/numbers so the search + filter feature can
    // query them reliably (URL params use the lowercase enum codes). Automotive
    // only — hidden in the Studio for other verticals.
    defineField({
      name: 'vehicleSpecs',
      title: 'Vehicle specs',
      type: 'object',
      description: 'Typed, filterable automotive dimensions.',
      options: { collapsible: true, collapsed: false },
      fields: [
        defineField({
          name: 'bodyType',
          title: 'Body type',
          type: 'string',
          description: 'Overall body style. Filterable.',
          options: {
            list: [
              { title: 'Sedan', value: 'sedan' },
              { title: 'Hatchback', value: 'hatchback' },
              { title: 'SUV', value: 'suv' },
              { title: 'Ute', value: 'ute' },
              { title: 'Wagon', value: 'wagon' },
              { title: 'Van', value: 'van' },
              { title: 'Coupe', value: 'coupe' },
              { title: 'Convertible', value: 'convertible' },
            ],
          },
        }),
        defineField({
          name: 'transmission',
          title: 'Transmission',
          type: 'string',
          description: 'Gearbox type. Filterable.',
          options: {
            list: [
              { title: 'Automatic', value: 'auto' },
              { title: 'Manual', value: 'manual' },
            ],
          },
        }),
        defineField({
          name: 'fuelType',
          title: 'Fuel type',
          type: 'string',
          description: 'Fuel/energy source. Filterable.',
          options: {
            list: [
              { title: 'Petrol', value: 'petrol' },
              { title: 'Diesel', value: 'diesel' },
              { title: 'Hybrid', value: 'hybrid' },
              { title: 'Electric', value: 'electric' },
              { title: 'LPG', value: 'lpg' },
            ],
          },
        }),
        defineField({
          name: 'driveType',
          title: 'Drive type',
          type: 'string',
          description: 'Driven wheels. Filterable.',
          options: {
            list: [
              { title: '2WD', value: '2wd' },
              { title: 'AWD', value: 'awd' },
              { title: '4WD', value: '4wd' },
            ],
          },
        }),
        defineField({
          name: 'seatCount',
          title: 'Seats',
          type: 'number',
          description: 'Number of seats. Filterable.',
          validation: (Rule) => Rule.integer().min(1).max(20),
        }),
        defineField({
          name: 'year',
          title: 'Year',
          type: 'number',
          description: 'Model/build year. Filterable.',
          validation: (Rule) => Rule.integer().min(1900),
        }),
        defineField({
          name: 'odometer',
          title: 'Odometer (km)',
          type: 'number',
          description: 'Odometer reading in kilometres. Filterable.',
          validation: (Rule) => Rule.min(0),
        }),
        defineField({
          name: 'condition',
          title: 'Condition',
          type: 'string',
          description: 'Sale condition. Filterable.',
          options: {
            list: [
              { title: 'New', value: 'new' },
              { title: 'Used', value: 'used' },
              { title: 'Demo', value: 'demo' },
            ],
          },
        }),
      ],
    }),

    // Timestamps.
    defineField({
      name: 'listingDate',
      title: 'Listing date',
      type: 'datetime',
      description: 'When the listing was created/posted.',
      initialValue: () => new Date().toISOString(),
    }),
    defineField({
      name: 'updatedAt',
      title: 'Updated at',
      type: 'datetime',
      description: 'Last updated.',
    }),
  ],
  preview: {
    select: { title: 'title', subtitle: 'status', media: 'images.0' },
  },
});
