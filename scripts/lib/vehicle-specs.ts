/**
 * scripts/lib/vehicle-specs.ts
 *
 * DEMO-ONLY TOOLING — shared mapper that turns loose `details[]` key/value rows
 * into the typed `vehicleSpecs` fields. Single source of truth reused by the
 * migration (`migrate-details-to-specs.ts`) and the seed/import scripts so the
 * label-matching and enum-normalisation logic can't drift between them.
 *
 * Design: a label maps to a spec field by case-insensitive substring; a value
 * normalises to a lowercase enum code (the code we filter by in URL params). If
 * a value can't be confidently normalised it is SKIPPED and a warning is
 * emitted — never guessed. The failure mode is "field left empty" (a human can
 * fix it in Studio), not "wrong data written".
 */

export type VehicleSpecField =
  | 'bodyType'
  | 'transmission'
  | 'fuelType'
  | 'driveType'
  | 'seatCount'
  | 'year'
  | 'odometer'
  | 'condition';

/** A loose view of a `details[]` array member — only the fields we read. */
export interface DetailLike {
  label?: string;
  value?: string;
  valueNumber?: number;
  valueBoolean?: boolean;
  valueDate?: string;
  valueType?: string;
}

/** One confident mapping from a detail row to a typed spec field. */
export interface SpecEntry {
  field: VehicleSpecField;
  /** Human-readable source value from `details[]`, for diff/warn output. */
  raw: string;
  /** Normalised typed value written to `vehicleSpecs`. */
  typed: string | number;
}

/** Plain object form of the typed fields. */
export type VehicleSpecs = Partial<{
  bodyType: string;
  transmission: string;
  fuelType: string;
  driveType: string;
  seatCount: number;
  year: number;
  odometer: number;
  condition: string;
}>;

// --- Label → field matching --------------------------------------------------
// Case-insensitive substring. First match wins. Order the number fields so the
// more specific substrings are checked before the looser ones (e.g. a label
// only reaches `year` if it wasn't already claimed).
const LABEL_MATCHERS: ReadonlyArray<{ field: VehicleSpecField; needles: string[] }> = [
  { field: 'bodyType', needles: ['body', 'style'] },
  { field: 'transmission', needles: ['transmission', 'gearbox'] },
  { field: 'fuelType', needles: ['fuel'] },
  { field: 'driveType', needles: ['drive'] },
  { field: 'seatCount', needles: ['seat'] },
  { field: 'odometer', needles: ['odometer', 'mileage', 'kilometres'] },
  { field: 'year', needles: ['year'] },
  { field: 'condition', needles: ['condition'] },
];

/** Map a details label to a spec field, or null if it isn't one we filter on. */
export function matchSpecField(label: string | undefined): VehicleSpecField | null {
  if (!label) return null;
  const l = label.toLowerCase();
  for (const { field, needles } of LABEL_MATCHERS) {
    if (needles.some((n) => l.includes(n))) return field;
  }
  return null;
}

// --- Enum normalisation ------------------------------------------------------
// For each enum field, an ordered list of { code, patterns }. A raw value
// (lowercased) matches the first code whose any pattern is a substring. The code
// itself is always an implicit pattern. Order matters where patterns overlap
// (e.g. SUV before Ute so "sports utility vehicle" isn't caught by "utility").
type EnumSpec = ReadonlyArray<{ code: string; patterns: string[] }>;

const ENUM_MAPS: Record<'bodyType' | 'transmission' | 'fuelType' | 'driveType' | 'condition', EnumSpec> = {
  bodyType: [
    { code: 'suv', patterns: ['suv', 'sports utility'] },
    { code: 'hatchback', patterns: ['hatch'] },
    { code: 'sedan', patterns: ['sedan', 'saloon'] },
    { code: 'ute', patterns: ['ute', 'utility', 'pickup', 'pick-up', 'cab chassis', 'dual cab', 'crew cab', 'king cab', 'single cab'] },
    { code: 'wagon', patterns: ['wagon', 'estate'] },
    { code: 'van', patterns: ['van', 'people mover'] },
    { code: 'coupe', patterns: ['coupe', 'coupé'] },
    { code: 'convertible', patterns: ['convertible', 'cabriolet', 'cabrio', 'roadster'] },
  ],
  transmission: [
    { code: 'auto', patterns: ['auto', 'cvt', 'dsg', 'dct', 'tiptronic'] },
    { code: 'manual', patterns: ['manual'] },
  ],
  fuelType: [
    { code: 'diesel', patterns: ['diesel'] },
    // Hybrid MUST be tested before electric: "petrol-electric" (and its space/
    // slash variants) is a hybrid drivetrain but contains the substring
    // "electric", so it would otherwise fall through to the generic electric
    // pattern. Specific-before-generic keeps it deterministic.
    {
      code: 'hybrid',
      patterns: ['hybrid', 'petrol-electric', 'petrol electric', 'petrol/electric'],
    },
    { code: 'electric', patterns: ['electric'] },
    { code: 'lpg', patterns: ['lpg', 'autogas'] },
    { code: 'petrol', patterns: ['petrol', 'unleaded', 'pulp', 'gasoline'] },
  ],
  driveType: [
    { code: 'awd', patterns: ['awd', 'all wheel', 'all-wheel'] },
    { code: '4wd', patterns: ['4wd', '4x4', '4 wd', 'four wheel'] },
    { code: '2wd', patterns: ['2wd', '2 wd', 'rwd', 'fwd', 'rear wheel', 'front wheel', 'two wheel'] },
  ],
  condition: [
    { code: 'demo', patterns: ['demo', 'demonstrator'] },
    { code: 'used', patterns: ['used', 'pre-owned', 'preowned', 'second hand', 'second-hand'] },
    { code: 'new', patterns: ['new'] },
  ],
};

// Transmission signals used to detect genuinely-ambiguous compound values.
const TRANSMISSION_AUTO_SIGNAL = /auto|cvt|dsg|dct|tiptronic/;
const TRANSMISSION_MANUAL_SIGNAL = /manual/;

function normaliseEnum(field: keyof typeof ENUM_MAPS, raw: string): string | null {
  const r = raw.toLowerCase().trim();
  if (!r) return null;
  // Ambiguity guard: a transmission value carrying BOTH an automatic and a
  // manual signal (e.g. "automated manual", "automatic with manual mode") can't
  // be resolved by ordering — neither answer is clearly correct — so bail to a
  // WARN rather than guess. Plain "…automatic" / "…manual" values are unaffected.
  if (
    field === 'transmission' &&
    TRANSMISSION_AUTO_SIGNAL.test(r) &&
    TRANSMISSION_MANUAL_SIGNAL.test(r)
  ) {
    return null;
  }
  for (const { code, patterns } of ENUM_MAPS[field]) {
    if (code === r || patterns.some((p) => r.includes(p))) return code;
  }
  return null;
}

// --- Number parsing ----------------------------------------------------------
/** Prefer the structured number; else strip commas/units from the display value. */
function parseNumber(d: DetailLike): number | null {
  if (typeof d.valueNumber === 'number' && Number.isFinite(d.valueNumber)) {
    return Math.round(d.valueNumber);
  }
  if (typeof d.value === 'string') {
    const cleaned = d.value.replace(/[^0-9.-]/g, '');
    if (cleaned) {
      const n = Number(cleaned);
      if (Number.isFinite(n)) return Math.round(n);
    }
  }
  return null;
}

/** Best human representation of a detail's source value, for diff/warn output. */
function rawOf(d: DetailLike): string {
  if (typeof d.value === 'string' && d.value.trim()) return d.value.trim();
  if (typeof d.valueNumber === 'number') return String(d.valueNumber);
  if (typeof d.valueBoolean === 'boolean') return d.valueBoolean ? 'Yes' : 'No';
  if (typeof d.valueDate === 'string') return d.valueDate;
  return '';
}

// --- Public API --------------------------------------------------------------
export interface DeriveOptions {
  /** Emitted for a matched label whose value couldn't be normalised. */
  onWarn?: (message: string) => void;
}

/**
 * Derive confident typed spec entries from a listing's `details[]`. Only labels
 * that map to a spec field AND whose value normalises are returned; unmatched
 * labels are ignored silently, matched-but-unmappable values emit a warning.
 */
export function deriveVehicleSpecs(details: DetailLike[] | undefined, opts: DeriveOptions = {}): SpecEntry[] {
  const warn = opts.onWarn ?? ((m: string) => console.warn(`WARN: ${m}`));
  const entries: SpecEntry[] = [];
  const seen = new Set<VehicleSpecField>();

  for (const d of details ?? []) {
    const field = matchSpecField(d.label);
    if (!field) continue;
    if (seen.has(field)) continue; // first mapped row wins per field
    const raw = rawOf(d);
    if (!raw) continue; // empty scaffold row — nothing to map, not a warning

    if (field === 'seatCount' || field === 'year' || field === 'odometer') {
      const n = parseNumber(d);
      if (n == null) {
        warn(`${d.label ?? field}: could not parse a number from "${raw}" — skipped`);
        continue;
      }
      entries.push({ field, raw, typed: n });
      seen.add(field);
      continue;
    }

    // Enum field.
    const code = normaliseEnum(field, raw);
    if (code == null) {
      warn(`${d.label ?? field}: "${raw}" did not match any ${field} code — skipped`);
      continue;
    }
    entries.push({ field, raw, typed: code });
    seen.add(field);
  }

  return entries;
}

/** Convenience: collapse derived entries into a plain `vehicleSpecs` object. */
export function specsFromDetails(details: DetailLike[] | undefined, opts: DeriveOptions = {}): VehicleSpecs {
  const specs: VehicleSpecs = {};
  for (const { field, typed } of deriveVehicleSpecs(details, opts)) {
    (specs as Record<string, string | number>)[field] = typed;
  }
  return specs;
}
