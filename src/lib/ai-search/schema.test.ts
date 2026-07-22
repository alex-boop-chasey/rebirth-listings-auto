/**
 * Tests for the AI-search extraction schema + FilterState converter.
 * Run with: npm run test:ai-search  (node --test via the tsx loader; no framework).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ExtractionSchema,
  AiFiltersSchema,
  toFilterState,
  toSearchResponse,
  fallbackResponse,
  emptyFilterState,
  normalizeCurrentFilters,
} from './schema';
import { parseFilters } from '../listings-query';

// (a) A valid extraction round-trips through the schema; defaults fill the gaps.
test('valid extraction parses and applies defaults', () => {
  const r = ExtractionSchema.safeParse({
    interpretation: 'A hybrid SUV under $40k.',
    confidence: 'high',
    clarifyingQuestion: null,
    filters: { bodyType: ['suv'], fuelType: ['hybrid'], priceMax: 40000 },
    matchReasons: ['SUV', 'hybrid', 'under $40k'],
  });
  assert.equal(r.success, true);
  if (!r.success) return;
  assert.deepEqual(r.data.filters.transmission, []); // default
  assert.equal(r.data.filters.priceMin, null); // default
  assert.equal(r.data.filters.sort, null); // default
});

// (b) Out-of-enum values are REJECTED, not coerced.
test('out-of-enum fuelType is rejected', () => {
  const r = ExtractionSchema.safeParse({
    interpretation: 'x',
    confidence: 'high',
    clarifyingQuestion: null,
    filters: { fuelType: ['hydrogen'] },
    matchReasons: [],
  });
  assert.equal(r.success, false);
});

test('out-of-enum bodyType is rejected', () => {
  const r = AiFiltersSchema.safeParse({ bodyType: ['spaceship'] });
  assert.equal(r.success, false);
});

test('invalid confidence is rejected', () => {
  const r = ExtractionSchema.safeParse({
    interpretation: 'x',
    confidence: 'very-high',
    clarifyingQuestion: null,
    filters: {},
    matchReasons: [],
  });
  assert.equal(r.success, false);
});

// (c) Converter output is byte-identical to a Phase 1 URL parse.
test('toFilterState equals a Phase 1 parse of the equivalent query string', () => {
  const filters = AiFiltersSchema.parse({
    bodyType: ['suv'],
    fuelType: ['hybrid', 'electric'],
    driveType: ['4wd'],
    seats: [7],
    priceMax: 40000,
    yearMin: 2018,
    odoMax: 80000,
    sort: 'price-asc',
  });
  const converted = toFilterState(filters);
  const qs =
    'bodyType=suv&fuelType=hybrid,electric&driveType=4wd&seats=7&priceMax=40000&yearMin=2018&odoMax=80000&sort=price-asc';
  const parsed = parseFilters(new URLSearchParams(qs));
  assert.deepEqual(converted, parsed);
});

test('seat counts outside the offered set are dropped, matching Phase 1', () => {
  const converted = toFilterState(AiFiltersSchema.parse({ seats: [6, 7] }));
  assert.deepEqual(converted.seats, [7]); // 6 is not an offered seat count
});

// (d) Empty / edge inputs never crash and stay valid.
test('empty filters convert to the canonical empty FilterState', () => {
  const empty = toFilterState(AiFiltersSchema.parse({}));
  assert.deepEqual(empty, emptyFilterState());
  assert.equal(empty.page, 1);
});

test('fallbackResponse is a valid low-confidence shape with a question', () => {
  const fb = fallbackResponse();
  assert.equal(fb.confidence, 'low');
  assert.ok(fb.clarifyingQuestion && fb.clarifyingQuestion.length > 0);
  assert.deepEqual(fb.matchReasons, []);
  assert.equal(fb.filters.page, 1);
});

test('low confidence without a question gets one injected', () => {
  const ex = ExtractionSchema.parse({
    interpretation: 'too vague',
    confidence: 'low',
    clarifyingQuestion: null,
    filters: {},
    matchReasons: [],
  });
  const resp = toSearchResponse(ex);
  assert.equal(resp.confidence, 'low');
  assert.ok(resp.clarifyingQuestion && resp.clarifyingQuestion.length > 0);
});

test('normalizeCurrentFilters tolerates garbage and drops bad values', () => {
  assert.deepEqual(normalizeCurrentFilters(null), emptyFilterState());
  assert.deepEqual(normalizeCurrentFilters('nonsense'), emptyFilterState());
  assert.deepEqual(normalizeCurrentFilters({ fuelType: ['banana'] }).fuelType, []);
  assert.deepEqual(normalizeCurrentFilters({ fuelType: ['hybrid'], priceMax: 30000 }).fuelType, [
    'hybrid',
  ]);
});
