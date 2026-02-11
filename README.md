# ThinkShip-Core

ThinkShip-Core is a modular Node.js audit engine exposed as an Express REST API.

## Features

- Performance audit via PageSpeed Insights API (LCP, INP/FID, CLS)
- SEO audit via Cheerio (meta tags, JSON-LD, image alt attributes, legacy DOM hints)
- Security audit (CSP, X-Frame-Options, and recommended headers)
- Separate API endpoints per audit type
- Combined endpoint for running all audits in one request
- Multi-audit requests run auditors in parallel to reduce response time
- Short-lived response cache for repeated `all`/`deep` requests
- Deep audit endpoint that enriches standard audits with AI-generated optimization steps
- Vercel-ready server entrypoint and catch-all routing for API deployment
- Graceful handling for invalid URLs, 404s, and request timeouts

## Install

```bash
npm install
```

If your shell requires Node setup first:

```bash
source ~/.zshrc && _load_nvm
```

## Run Server

```bash
npm start
```

Server default:

- `http://localhost:4000`
- `GET /` returns service status
- `GET /health` returns `{ "status": "ok" }`

Health check:

```bash
curl http://localhost:4000/health
```

## REST API

Base path: `/api/audits`

Endpoints:

- `POST /api/audits/perf`
- `POST /api/audits/seo`
- `POST /api/audits/security`
- `POST /api/audits/all`
- `POST /api/audits/deep`
- `POST /api/audits/deep/progress` (SSE stream)

Request body:

```json
{
  "url": "https://example.com",
  "timeoutMs": 0,
  "pageSpeedApiKey": "optional-key",
  "types": ["perf", "seo", "security"]
}
```

Notes:

- `url` is required.
- `timeoutMs` defaults to `0` (no timeout).
- `types` is used by `/all` and `/deep`.
- `pageSpeedApiKey` can be omitted when env key is available.
- Performance metrics include unified `metrics.interactivity` (`INP` preferred, `FID` fallback).
- Responses include scoring out of 100 at audit and summary level:
  - `details.scoring = { score, outOf: 100 }`
  - `summary.scoring = { score, outOf: 100 }`
  - plus `details.recommendations[]` and `summary.topFindings`.
- `/deep` response includes `deepAnalysis` in addition to the standard report payload.
- `/deep/progress` streams stage-by-stage status events while the request is running.
- Every streamed event includes a frontend-ready status payload:
  - `requestId`, `stage`, `status`, `progress`, `message`, `timestamp`
- `/deep/progress` emits stages:
  - `request_received`
  - `baseline_audit_started`
  - repeated `baseline_audit_progress` (per-audit started/completed updates)
  - `audit_report` (each baseline report generated)
  - `baseline_audit_completed`
  - `deep_analysis_started`
  - repeated `deep_analysis_progress` while Groq is running
  - `deep_analysis_completed` or `deep_analysis_skipped`
  - `response_preparing`
  - final SSE event `completed` with stage `response_dispatched` and full `result`
- `/all` and `/deep` cache identical request payloads for a short TTL (default `60s`).
- `/deep` may skip the LLM call when score is already healthy (`overallScore >= 90` and no errors).
- If the deep-agent call times out or fails upstream, `/deep` still returns 200 with a fallback `deepAnalysis` status payload.

Example: Performance audit

```bash
curl -X POST http://localhost:4000/api/audits/perf \
  -H "Content-Type: application/json" \
  -d '{"url":"https://vivasoftltd.com","timeoutMs":0}'
```

Example: All audits

```bash
curl -X POST http://localhost:4000/api/audits/all \
  -H "Content-Type: application/json" \
  -d '{"url":"https://vivasoftltd.com","timeoutMs":0}'
```

Example: Deep audit

```bash
curl -X POST http://localhost:4000/api/audits/deep \
  -H "Content-Type: application/json" \
  -d '{"url":"https://vivasoftltd.com","timeoutMs":0}'
```

Example: Deep audit with live progress stream

```bash
curl -N -X POST http://localhost:4000/api/audits/deep/progress \
  -H "Content-Type: application/json" \
  -d '{"url":"https://vivasoftltd.com","timeoutMs":0}'
```

## Environment Variables

- `PAGESPEEDINSIGHTS_API_KEY` (optional, fallback for performance audit)
- `GROQ_API_KEY` (required for AI deep audit quality)
- `PORT` (optional, local server only; defaults to `4000`)
- `AUDIT_CACHE_TTL_MS` (optional, cache TTL in ms for `/all` and `/deep`; default `60000`, set `0` to disable)
- request `pageSpeedApiKey` takes precedence over `.env`

## NPM Scripts

```bash
npm test
npm start
```

## Vercel Deployment Notes

- Vercel function entrypoint is `api/index.js` (exports the Express app).
- `vercel.json` routes all incoming paths to `/api/index.js`.
- Keep both `api/index.js` and `vercel.json` committed for Git-based deployments.
- On Vercel, `process.env.VERCEL` is set automatically, so local `app.listen(...)` is skipped.

## Architecture

Code is split to keep business logic reusable across transports:

- Core logic: `src/core`
  - `auditors/` plugin modules
  - `engine/` registry + runner
  - `utils/` URL, HTTP, log utilities
- Server transport: `src/server`
  - `routes/`, `controllers/`, `services/`, `middleware/`, `validation/`
- Shared utils: `src/shared`

## Use Core Logic in Next.js

```js
// app/api/audit/route.js (example)
import { analyzeWebsite } from "thinkship-core";

export async function POST(req) {
  const body = await req.json();
  const report = await analyzeWebsite({
    url: body.url,
    types: body.types ?? ["perf", "seo", "security"],
    timeoutMs: body.timeoutMs ?? 0,
    pageSpeedApiKey: process.env.PAGESPEEDINSIGHTS_API_KEY,
  });

  return Response.json(report);
}
```

## Add a New Auditor

Each auditor is a module with:

- `key`: unique ID (example: `accessibility`)
- `name`: display label
- `run(input)`: async function returning:
  - `status`: `PASS | WARN | FAIL`
  - `details`: structured audit data
  - `logs`: entries using `INFO | WARNING | ERROR`

Steps:

1. Create a new file under `src/core/auditors/`.
2. Register it in `createDefaultRegistry()` in `src/core/index.js`.
3. Add tests under `tests/auditors/`.

## Testing

```bash
npm test
```

Current coverage includes registry behavior, URL/type normalization, runner orchestration, and all three built-in auditors.
