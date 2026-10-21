# Continuation verification — Aurora Music Web (2026-10-21, legion wake)

Context: `t_64e24dc9` (pixel, "Aurora whole-app audit") ran 18 times and was
quota-walled every time (429/402 from bynara, nvidia-new, openrouter). It was
later archived, so the audit was delivered in-session instead
(`legion/VISUAL-AUDIT.md`, `legion/WORKING-AUDIT.md`, commit `f14c1c1`).
This file records an independent re-verification of those claims against the
running code, plus the actual deployment state found on this box.

## Test suite (re-run here, not quoted from the report)

`node node_modules/vitest/vitest.mjs run` → **35 files / 181 tests, all passing**
(~150 s). Note: `npx vitest` / `node_modules/.bin/vitest` fail with
"Operation not permitted" because the `.bin` symlinks are unreadable on this
mount; call `node node_modules/vitest/vitest.mjs` directly.

## WORKING-AUDIT.md claims re-tested

| claim | result |
|-------|--------|
| W1 health 200 | PASS (also `ytDlp.ready: true`) |
| W2 home 2 sections | PASS |
| W3 search → 20 tracks, first `3HlzLiCL9Xs` "Jaan Nisaar (Arijit)" | PASS |
| W4 lyrics, 6 providers on "Beat It" | PASS, all six live (see counts below) |
| W4b niche track degrades gracefully | PASS (BetterLyrics + Lyrics.ovh empty, 4 others hit) |
| W5 analysis `3HlzLiCL9Xs` → bpm 60, blend 235.5, outro 235.5, dur 238.4 | PASS, exact match |
| W5b "Beat It" → bpm 70.6, blend 251.6 of 258.4 | PASS on `kOn-HdEg6AQ` (Michael Jackson): bpm 70.6, blendStart 251.6, duration 258.40 |
| W6 stream 200, 3,857,000 bytes, audio/mp4 | PASS, byte-exact |
| W7 range → 206, 1000 bytes | PASS |
| W8 prefetch → 204 | PASS |
| W10 `/` and `/settings` → 200 with `#root` | PASS (`/` and `/library` 200 via tunnel too) |
| W9 tunnel `ian-depth-pix-joint.trycloudflare.com` | **STALE** — that quick tunnel no longer resolves; quick tunnels are ephemeral. New tunnel below. |

Lyrics provider counts re-measured on "Beat It" (`kOn-HdEg6AQ`):
YouLyPlus synced 77 · BetterLyrics synced 77 · LRCLIB synced 55 ·
Unison synced 59 · Lyrics.ovh plain 33 · YouTube Music plain 53.
(The report lists YouLyPlus as 56 for this track; 77 is what it returns now —
a stale number, every provider itself is live.)

## VISUAL-AUDIT.md claims re-tested

- V1 (stale Vite module graph 404 on the three pages): the three modules now
  serve 200 — `LibraryPage.tsx` 86,827 B · `ExplorePage.tsx` 19,181 B ·
  `StatsPage.tsx` 52,609 B. The report's "86 KB / 19 KB / 52 KB" matches.
- V5 / commit `cf3d986`: the fix is present in `src/styles.css:1278`
  (`.glass-surface:not(.player-dock):not(.side-rail):not(.bottom-nav)`).
- The evidence screenshots the report points at
  (`/opt/data/cache/scratch/am-home.png`, `am-fullplayer-blend.png`) are gone —
  the scratch dir is pruned. Those two images are unverified.

## AUTOMIX-REVIEW.md (t_4b8dfb02) — several findings are stale

Checked against current `src/lib/songTransitions.ts` and
`src/lib/playbackEngine.ts`:

- Bug 1 (shuffle picks a different index in `prepareNext()` and `next()`) is
  **already fixed**: `playbackEngine.ts:365` calls `state.setShuffleNextIndex(index)`
  and `store/playback.ts:219` honours `shuffleNextIndex`. The review predates
  the fix.
- Bug 4 (blend length `max(3, min(9, shorter*0.025))`) is **already fixed**:
  `songTransitions.ts:32` now uses `max(MIN_BLEND_SECONDS, min(12, shorter*0.03))`
  capped at `shorter/4`.
- Bug 2 (`findQuietPoint` / `energyEnvelope` dead code) still holds: no
  production caller, only `tests/track-analysis.test.ts`.
- Line references in the review are off by a few lines (e.g. it cites
  `chooseTransitionPoint` at `songTransitions.ts:41`, it is at line 53; it
  cites the `planTransition` call at `playbackEngine.ts:411`, it is at 420).
  Substantive conclusions survive; the citations do not.

## Deployment reality (the part the reports did not cover)

- The Render service `aurora-music-web.onrender.com` returns **503 "This
  service has been suspended"** — the production deploy is down on Render's
  side (account/billing, not code). Nothing in the repo can fix that; it
  needs the human to reinstate the service.
- On this box, `aurora-server.sh` (port 4188, sets
  `YT_DLP_COOKIE_FILE=/opt/data/api-vault/yt-cookies.txt`) was **not running**
  and no process held 4188. It has been started again by the continuation
  agent and answers on `http://127.0.0.1:4188`.
- **Cookies are mandatory.** Without `YT_DLP_COOKIE_FILE` every yt-dlp call
  fails with "Sign in to confirm you're not a bot" → `/api/v1/stream` 502 and
  `/api/v1/analysis` 204. With the cookie file, the same calls return
  200/206 and real analysis. Any restart of the server must keep that env var.
- The named tunnel (`sugam.cc.cd`) points at the Hermes dashboard on
  :10000, not at Aurora, so Aurora was not publicly reachable. A fresh quick
  tunnel was started for it and verified:
  **https://ipaq-bear-markers-oliver.trycloudflare.com** —
  health 200, `/` 200, `/library` 200, stream 200 with 3,857,000 bytes.
