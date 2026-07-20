/**
 * Low-level SSE + JSON parsing helpers for the OpenRouter adapter.
 *
 * This file is deliberately provider-*fault-agnostic*: it frames Server-Sent
 * Events and shapes raw JSON into small typed views, but it never constructs a
 * `ProviderError` or decides retryability — that classification lives in
 * `openrouter.ts`. Keeping the wire-parsing here keeps the adapter under its
 * size budget and makes the parsing independently readable.
 *
 * Internal to the OpenRouter adapter — do not import from outside this folder.
 */

import type { FinishReason, TokenUsage } from '../types';

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Map OpenRouter's finish_reason to our enum; unknown values become `error`. */
export function mapFinishReason(raw: unknown): FinishReason {
  return raw === 'stop' || raw === 'length' ? raw : 'error';
}

/** Lift `{ prompt_tokens, completion_tokens }` into `TokenUsage`, if present. */
export function extractUsage(usage: unknown): TokenUsage | undefined {
  if (!isRecord(usage)) return undefined;
  const input = usage.prompt_tokens;
  const output = usage.completion_tokens;
  if (typeof input === 'number' && typeof output === 'number') return { input, output };
  return undefined;
}

/** A provider `error` object lifted from a 200-body or an SSE `error` event. */
export interface BodyError {
  message?: string;
  code?: string | number;
}

/** Pull an `{ error: { message?, code? } }` shape out of a parsed body/chunk. */
export function extractBodyError(parsed: unknown): BodyError | null {
  if (!isRecord(parsed)) return null;
  const err = parsed.error;
  if (!isRecord(err)) return null;
  const message = typeof err.message === 'string' ? err.message : undefined;
  const code =
    typeof err.code === 'string' || typeof err.code === 'number' ? err.code : undefined;
  return { message, code };
}

/** Parsed view of one SSE `data:` payload. */
export interface SseChunk {
  isDone: boolean; // payload was the `[DONE]` sentinel
  contentDelta?: string;
  finishReason?: FinishReason;
  model?: string;
  usage?: TokenUsage;
  error?: BodyError;
}

/**
 * Parse a single SSE data payload (the text after `data:`, wrapping stripped).
 * Returns `null` for unparseable fragments (keep-alives, partial JSON that
 * slipped through) so the caller simply skips them.
 */
export function parseSseData(data: string): SseChunk | null {
  if (data === '[DONE]') return { isDone: true };

  let j: unknown;
  try {
    j = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(j)) return null;

  const bodyErr = extractBodyError(j);
  if (bodyErr) return { isDone: false, error: bodyErr };

  const out: SseChunk = { isDone: false };
  if (typeof j.model === 'string' && j.model) out.model = j.model;
  const usage = extractUsage(j.usage);
  if (usage) out.usage = usage;

  const choices = j.choices;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  if (isRecord(first)) {
    const delta = first.delta;
    if (isRecord(delta) && typeof delta.content === 'string' && delta.content) {
      out.contentDelta = delta.content;
    }
    if (first.finish_reason !== undefined && first.finish_reason !== null) {
      out.finishReason = mapFinishReason(first.finish_reason);
    }
  }
  return out;
}

/**
 * Extract the joined `data:` payload from one SSE event block (the text between
 * two `\n\n` separators). Per the SSE spec: lines beginning `:` are comments/
 * keep-alives and ignored, multiple `data:` lines join with `\n`, and one
 * optional leading space after the colon is stripped. Returns `null` when the
 * block carries no data line.
 */
export function extractEventData(block: string): string | null {
  const dataLines: string[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, ''); // tolerate CRLF
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    // other SSE fields (event:, id:, retry:) are irrelevant here
  }
  return dataLines.length ? dataLines.join('\n') : null;
}
