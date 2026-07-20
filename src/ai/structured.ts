/**
 * Prompt-building and parsing helpers for `generateObject()`.
 *
 * Pure functions only — no I/O, no fallback orchestration (that stays in
 * `client.ts`). Split out so the structured-output mechanics (schema → prompt,
 * raw text → validated object, repair-prompt wording) read on their own.
 */

import { z } from 'zod';
import type { AIMessage, AIResponse } from './types';

/** Which of the two failure modes a raw response hit while being structured. */
export type ParseFailureKind = 'parse' | 'validation';

/** Outcome of parsing + validating one raw model response against a schema. */
export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; failure: ParseFailureKind; summary: string; cause: unknown };

/**
 * Build the messages for a structured-output request: a fresh system message
 * carrying the JSON Schema and "reply with ONLY JSON" instructions, prepended
 * to the caller's messages. The caller's array is never mutated; if it already
 * opens with a system message, ours simply precedes it (two system messages are
 * fine for OpenRouter and keeps the two intents separate).
 */
export function buildStructuredMessages<T>(
  messages: AIMessage[],
  schema: z.ZodType<T>,
  schemaName?: string
): AIMessage[] {
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema), null, 2);
  const nameSentence = schemaName ? ` The object represents a \`${schemaName}\`.` : '';
  const instruction =
    `You must respond with a single JSON object that conforms to the following JSON Schema.` +
    nameSentence +
    `\n\n\`\`\`json\n${jsonSchema}\n\`\`\`\n\n` +
    `Respond with ONLY the JSON object — no markdown code fences, and no explanatory text before or after it.`;
  return [{ role: 'system', content: instruction }, ...messages];
}

/**
 * Build the repair conversation after a failed attempt: the original augmented
 * messages, the model's raw (failed) response echoed back as an assistant turn,
 * then a user turn describing what went wrong. Parse and validation failures get
 * distinct guidance.
 */
export function buildRepairMessages(
  base: AIMessage[],
  rawResponse: string,
  failure: ParseFailureKind,
  summary: string
): AIMessage[] {
  const guidance =
    failure === 'parse'
      ? `The previous response was not valid JSON. Respond again with ONLY a valid JSON object matching the schema. The parse error was: \`${summary}\`.`
      : `The previous response was valid JSON but did not match the schema. The specific errors were:\n${summary}\nRespond again with a corrected JSON object, and ONLY the JSON object.`;
  return [...base, { role: 'assistant', content: rawResponse }, { role: 'user', content: guidance }];
}

/**
 * Parse + validate one raw model response. Strips a leading/trailing markdown
 * fence, extracts the outermost `{…}`, `JSON.parse`s it, then `safeParse`s
 * against the schema. Any step failing yields `{ ok: false }` with a summary
 * suitable for a repair prompt.
 */
export function parseStructured<T>(raw: string, schema: z.ZodType<T>): ParseResult<T> {
  const jsonText = extractJson(raw);
  if (jsonText === null) {
    return { ok: false, failure: 'parse', summary: 'No JSON object ({ … }) found in the response.', cause: null };
  }

  let value: unknown;
  try {
    value = JSON.parse(jsonText);
  } catch (err) {
    return { ok: false, failure: 'parse', summary: err instanceof Error ? err.message : String(err), cause: err };
  }

  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, failure: 'validation', summary: summariseZodError(result.error), cause: result.error };
}

/** Re-shape a successful string response into `AIResponse<T>`, carrying metadata. */
export function buildResponse<T>(source: AIResponse<string>, content: T): AIResponse<T> {
  const res: AIResponse<T> = {
    content,
    modelUsed: source.modelUsed,
    finishReason: source.finishReason,
  };
  if (source.tokensUsed) res.tokensUsed = source.tokensUsed;
  return res;
}

/**
 * Isolate the JSON object from a raw response: strip an outer ```json / ```
 * fence if present, then slice from the first `{` to the last `}`. Returns
 * `null` when no braces are found.
 */
function extractJson(raw: string): string | null {
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```[a-zA-Z0-9]*\s*\n?/, ''); // opening fence + optional language tag
    if (s.endsWith('```')) s = s.slice(0, -3);
    s = s.trim();
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  return s.slice(start, end + 1);
}

/**
 * Condense a Zod error into up to 5 `"<path>: <message>"` lines, truncated to
 * ~500 chars, for a lean repair prompt. Root-level issues render as `(root)`.
 */
function summariseZodError(error: z.ZodError): string {
  const lines = error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.length ? issue.path.join('.') : '(root)'}: ${issue.message}`);
  const summary = lines.join('\n');
  return summary.length > 500 ? `${summary.slice(0, 500)}…` : summary;
}
