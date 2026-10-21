# Aurora Music — Working Audit (functional)

**Verdict: SHIP** (all P0 behaviours pass; two P2s queued below). Every claim below was executed in this session; commands and outputs are quoted.

## Findings

| id | severity | area | evidence | result |
|----|----------|------|----------|--------|
| W1 | PASS | health | `curl /api/v1/health` → 200 | server up |
| W2 | PASS | home | `/api/v1/home` → 2 sections, JSON | OK |
| W3 | PASS | search | `/api/v1/search?q=arijit singh&type=song` → 20 tracks (first `3HlzLiCL9Xs` "Jaan Nisaar (Arijit)") | OK |
| W4 | PASS | lyrics | 6 providers × "Beat It": YouLyPlus synced/56, BetterLyrics synced/77, LRCLIB synced/55, Unison synced/59, Lyrics.ovh plain/33, YouTube Music plain/53 | all 6 live |
| W4b | PASS | lyrics (niche) | same track set on "Jaan Nisaar (Arijit)": YouLyPlus synced/33, LRCLIB synced/19, Unison synced/27, YouTube Music plain/33; BetterLyrics + Lyrics.ovh empty (expected: niche track, TTML/plain catalogues miss) | graceful degradation |
| W5 | PASS | analysis | `/api/v1/analysis/3HlzLiCL9Xs?duration=278` → bpm 60, blendStart 235.5, outroStart 235.5, duration 238.4 (blend in final 60s) | OK |
| W5b | PASS | analysis (Beat It) | bpm 70.6, blendStart 251.6 of 258.4 | OK |
| W6 | PASS | stream | `/api/v1/stream/3HlzLiCL9Xs` → 200, 3,857,000 bytes, 16 ms, `audio/mp4` | OK |
| W7 | PASS | range seek | `Range: bytes=0-999` → 206, `Content-Range: bytes 0-999/3857000`, 1000 bytes | OK |
| W8 | PASS | prefetch | 204 in 8 ms (cache-hit path; fresh-download path measured earlier this session at 8–11 s → 204) | OK |
| W9 | PASS | tunnel | `https://ian-depth-pix-joint.trycloudflare.com` health 200, stream 200 with full 3,857,000 bytes | OK |
| W10 | PASS | routes | `/` and `/settings` return 200 HTML with `#root` | OK |

## Code-verified (file:line, read-only)

- Engine loads the server analysis per track: `src/lib/playbackEngine.ts:139` (`void this.loadServerAnalysis(track)`)
- Blend plan uses the measured point: `src/lib/playbackEngine.ts:420` (`planTransition(... this.profileFor(state.currentTrack))`); the measured `blendStart` wins in `src/lib/songTransitions.ts` (chooseTransitionPoint early return)
- Same-album gapless skip: `src/lib/songTransitions.ts:114`
- Blend progress published to the store: `src/lib/playbackEngine.ts:464` (setTransition on fade start) and the fade timer updates progress; `cancelFade` clears it
- Position drift cannot cancel a running fade: `src/lib/playbackEngine.ts:238` (`if (!this.fading && ...)` guard)
- Shuffle plays the preloaded deck: engine records `src/lib/playbackEngine.ts:365` (`setShuffleNextIndex`), store honours it `src/store/playback.ts:219`
- Early prefetch: engine calls `prefetchTrack` in `prepareNext` as soon as the next track is known

## P2 (non-blocking)

- W-P2-1: `BetterLyrics` and `Lyrics.ovh` return empty for niche/regional tracks — acceptable fallback chain (4 providers still hit), no action required.
- W-P2-2: `/api/v1/search` response shape is `{items, tracks, ...}` (no `sections`) — client handles both; note for future API consumers.

## Environment notes

- Audits were run in-session because both Legion workers were quota-walled (minimax free tier and nvidia-new fallback each returned 429 on every run; no artifact was produced by them).
- Server was restarted during this audit (stale Vite dev graph was 404ing `/src/pages/LibraryPage.tsx`, `/src/pages/ExplorePage.tsx`, `/src/pages/StatsPage.tsx` — see VISUAL-AUDIT V1).
