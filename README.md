# ThinkShip-Core

ThinkShip-Core is a modular Node.js audit engine exposed as an Express REST API.

## Features

- Performance audit via PageSpeed Insights API (LCP, INP/FID, CLS)
- SEO audit via Cheerio (meta tags, JSON-LD, image alt attributes, legacy DOM hints)
- Security audit (CSP, X-Frame-Options, and recommended headers)
- Separate API endpoints per audit type
- Combined endpoint for running all audits in one request
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
- `types` is used only by `/all`.
- `pageSpeedApiKey` can be omitted when env key is available.
- Performance metrics include unified `metrics.interactivity` (`INP` preferred, `FID` fallback).
- Responses include scoring out of 100 at audit and summary level:
  - `details.scoring = { score, outOf: 100 }`
  - `summary.scoring = { score, outOf: 100 }`
  - plus `details.recommendations[]` and `summary.topFindings`.

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

Environment variable fallback:

- `PAGESPEEDINSIGHTS_API_KEY`
- request `pageSpeedApiKey` takes precedence over `.env`

## NPM Scripts

```bash
npm test
npm start
```

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
