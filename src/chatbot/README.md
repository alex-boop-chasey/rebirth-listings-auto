# Astro Motors — AI Chatbot

> Ported into this Astro 7 / Cloudflare **Worker** demo from the original Pages
> project. The one behavioural change: env/bindings are read via
> `cloudflare:workers` (see `get-env.ts`), NOT `locals.runtime.env` — that
> pattern was removed in `@astrojs/cloudflare` v14. The core handler, state,
> and telegram modules are otherwise unchanged.

A floating chat assistant ("Rebi") that answers visitor questions using the
business knowledge base, powered by [OpenRouter](https://openrouter.ai) with the
free `openai/gpt-oss-20b:free` model.

## Files

| File | Purpose |
| --- | --- |
| `knowledge.ts` | The business facts the bot is allowed to use. **Edit this to "train" the bot.** |
| `system-prompt.ts` | The bot's persona, voice, and guardrails (imports the knowledge). |
| `config.ts` | Model, endpoint, generation params, and abuse limits. |
| `core.ts` | **Portable** request handler — the actual brain. No framework deps. |
| `state.ts` | **Portable** D1 read/write layer for conversation memory. No framework deps. |
| `../../migrations/0001_chatbot_sessions.sql` | D1 schema for the `sessions` + `messages` tables. |
| `../pages/api/chat.ts` | Thin Astro API route that calls `core.ts` (used locally & now). |
| `../components/widgets/ChatWidget.astro` | The floating bubble UI (injected site-wide via `Layout.astro`). |

## Local development

1. The OpenRouter API key lives in `.dev.vars` (git-ignored, never committed):

   ```
   OPENROUTER_API_KEY=sk-or-v1-...
   ```

   The Cloudflare adapter's `platformProxy` exposes it to the API route via
   `locals.runtime.env` — the same pattern the contact form uses.

2. Run the dev server:

   ```bash
   npm run dev
   ```

3. Open the site, click the chat bubble (bottom-right), and chat.

### Rate limiting (KV) — optional locally

Per-IP rate limiting (10 messages/IP/hour, see `config.ts`) uses a Cloudflare KV
namespace bound as **`RATE_LIMIT_KV`**. If the binding is absent, rate limiting
is **skipped** (fail-open), so local dev works without any KV setup.

To exercise it locally, add a `wrangler.toml` in the project root so
`platformProxy` provisions a local KV store:

```toml
# wrangler.toml (local binding for the Astro Cloudflare adapter's platformProxy)
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "rate_limit_kv"          # any placeholder id; miniflare uses a local store
```

Restart `npm run dev` and the limiter becomes active against a local KV.

### Conversation memory (D1) — optional locally

Persistent multi-turn memory uses a Cloudflare D1 database bound as **`CHAT_DB`**
(schema in `migrations/0001_chatbot_sessions.sql`). If the binding is absent, all
persistence is **skipped** (fail-open) and the bot behaves exactly as before —
stateless, using only the history the browser sends. So local dev needs no D1
setup unless you're testing memory.

To exercise it locally:

1. Add a D1 binding to `wrangler.toml` in the project root so `platformProxy`
   provisions a local (miniflare) database:

   ```toml
   # wrangler.toml
   [[d1_databases]]
   binding = "CHAT_DB"
   database_name = "rebirth-chat"
   database_id = "local"        # any placeholder id; miniflare uses a local file
   ```

2. Apply the migration to the **local** database:

   ```bash
   npx wrangler d1 migrations apply rebirth-chat --local
   ```

3. Restart `npm run dev`. Conversations now persist across page refreshes, and
   the widget reuses its `reb-session-id` (stored in `localStorage`).

> Inspect the local store with, e.g.:
> `npx wrangler d1 execute rebirth-chat --local --command "SELECT * FROM messages"`

## Production (Cloudflare Pages)

This site already deploys through the `@astrojs/cloudflare` adapter, so
`src/pages/api/chat.ts` is compiled into the Cloudflare Worker automatically —
**no extra step is needed to ship the chatbot.**

Just add the secret in the Cloudflare dashboard:

> **Pages project → Settings → Environment variables → add `OPENROUTER_API_KEY`**
> (mark it as encrypted / secret).

### Rate limiting (KV) — production setup

1. Create a KV namespace:
   **Storage & Databases → KV → Create namespace** (e.g. `rebirth-chat-ratelimit`).
2. Bind it to the Pages project:
   **Pages project → Settings → Functions → KV namespace bindings → Add binding**
   with **Variable name `RATE_LIMIT_KV`** → select the namespace above.
3. Redeploy. The limiter (10 msgs/IP/hour) activates automatically once the
   binding is present. Tune the numbers via `RATE_LIMIT_MAX` /
   `RATE_LIMIT_WINDOW_SECONDS` in `config.ts`.

> If the binding is ever missing, the handler fails **open** (allows the
> request) rather than blocking visitors — see `checkRateLimit` in `core.ts`.

### Conversation memory (D1) — production setup

1. Create a D1 database:
   **Storage & Databases → D1 → Create database** (e.g. `rebirth-chat`).
2. Apply the schema to the **remote** database:

   ```bash
   npx wrangler d1 migrations apply rebirth-chat --remote
   ```

3. Bind it to the Pages project:
   **Pages project → Settings → Functions → D1 database bindings → Add binding**
   with **Variable name `CHAT_DB`** → select the database above.
4. Redeploy. Persistence activates automatically once the binding is present.

> If the binding is ever missing, the handler skips persistence and serves the
> reply statelessly rather than erroring — see the `CHAT_DB` checks in `core.ts`.
> All storage logic lives in `state.ts` so the backend stays swappable.

## Converting to a standalone Cloudflare Pages Function (later)

The logic is intentionally decoupled so it can move to a `/functions` route with
no rewrite. Because `core.ts` is framework-agnostic, you only add a wrapper:

```ts
// functions/api/chat.ts
import { handleChatRequest } from '../../src/chatbot/core';

type Env = {
  OPENROUTER_API_KEY: string;
  RATE_LIMIT_KV?: KVNamespace;
  CHAT_DB?: D1Database;
};

export const onRequestPost: PagesFunction<Env> =
  (context) => handleChatRequest(context.request, context.env);
```

`context.env.OPENROUTER_API_KEY` comes from the Pages environment variable above;
`RATE_LIMIT_KV` and `CHAT_DB` come from the bindings configured above. Nothing in
`core.ts`, `state.ts`, `config.ts`, `system-prompt.ts`, or `knowledge.ts` changes.

> Note: The Astro Cloudflare adapter uses advanced mode (`_worker.js`). If you
> switch to standalone `/functions`, remove the Astro `src/pages/api/chat.ts`
> route to avoid two handlers claiming the same path.
