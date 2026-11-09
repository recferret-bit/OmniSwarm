# W16 — Green gates and landing polish: owner check

Wave file: [`../waves/W16-green-gates.md`](../waves/W16-green-gates.md). Branch `wave/w16-green-gates` in `../OmniSwarm-wt/w16`. The main checkout stays on `main`. No provider key, no wallet, no Docker image of our own beyond what `check:infra` already builds.

## Automated

```sh
npm run check:w16
```

That is `npm run check:all` and then `bash tools/screener-check.sh`. On the wave branch, before this guide was added, that command finished green:

- schemas, tools, and intake: fail 0. `schema.gen.ts` matches `intake-api.schema.json`. The committed `openapi.json` matches the routes.
- landing: 25 files, 93 tests
- contract: 86 passed
- e2e landing: 5 passed, including axe on `/` and `/sample` and the binding-status step
- infra check ok (78s)
- harness self-test ok (104 patterns)
- engine `npm test`: 499 passed
- screener: four blocks ok (`harness --self-test`, `./bin/audit demo --no-docker`, the guard attack demo, `npm run eval:golden`), then `secret sweep ok` and `screener check ok`

`npm run guard -w apps/web` prints `production bundle checked (303 files): no mock wallet, MSW, mock controls, fixture hash or key-shaped strings`.

`npm run build -w apps/web` then `next start` renders `og:image` on the request host, not `localhost:3000`. A start on `127.0.0.1:31991` produced:

```html
<meta property="og:image" content="http://127.0.0.1:31991/sample/preview.jpg"/>
<meta property="og:image:width" content="1100"/>
<meta property="og:image:height" content="720"/>
```

Behind nginx the host comes from `X-Forwarded-Host` and the scheme from `X-Forwarded-Proto`. `apps/web/public/sample/preview.jpg` is 1100×720.

## Steps

**1. Every track.** `npm run check:all`. See the lines above. Empty tracks are not part of this command; each named track runs.

**2. Screener.** `bash tools/screener-check.sh`. See `screener ok:` four times, then `screener check ok`.

**3. Landing hash and one animation loop.** Open `http://omniswarm.localhost:18480/` with `npm run stack:local`, or the web dev server. The How-it-works line says "Two reviewers by default, up to six". The hash stage draws `cd8a533dc78a6d48e47e7fbe6bb7f9f591badd1e5854564cd4f3dd8f09ca38ab`, the `report_sha256` in `apps/web/public/sample/attestation.json`. Hide and show the tab ten times: one canvas loop keeps running. The unit tests that lock this are `how-scene.test.ts`, `how-paint.test.ts`, and `frame-loop.test.tsx`.

**4. Link preview.** The served `<head>` has `og:image` on that host plus `/sample/preview.jpg`, as quoted above. An empty sample-hash read draws "Reading the sample attestation." and does not print `LOCKED` or `MATCH`.

The two commit subjects named in W16-06 are not in `git log`. The painters, the sample-report buttons, and the dropped band borders are already on main as `62f9346` ("Show each review stage as a timed canvas picture."). The hash lock-in is `fc937b6` on this branch. Empty commits with the old subjects were not added.

## When you're done

All good: say "land W16". The lead merges `wave/w16-green-gates` with `--no-ff`, tags `wave-16`, and pushes. This guide does not tag the wave.

Something wrong: say which step failed and what you saw.
