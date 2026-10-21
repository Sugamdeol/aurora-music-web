# Aurora Music — Visual Audit (Apple Music design)

**Verdict: FIX-FIRST was applied during the audit (V1, fixed + verified). Ship.** All other checks pass; two P2s listed.

## Findings

| id | severity | area / viewport | measured | result |
|----|----------|-----------------|----------|--------|
| V1 | P0 (FIXED in-session) | /library, /explore, /stats — all viewports | The routes rendered the route-error boundary ("This page could not be opened"). Root cause: the long-running dev server's stale module graph 404'd `/src/pages/LibraryPage.tsx`, `ExplorePage.tsx`, `StatsPage.tsx` (server started 05:13; untouched files 404, files modified after start served 200 — confirmed by curl before/after). Server restart → all three now 200 (86 KB / 19 KB / 52 KB) and `/library` renders its content with no error boundary. | FIXED + verified |
| V2 | PASS | design tokens — desktop | `--accent: #fa233b`, `--bg: #0a0a0c`, `--surface: #141416`, font stack `-apple-system, BlinkMacSystemFont, 'SF Pro Text'…` | Apple Music palette live |
| V3 | PASS | logo + favicon | `.brand-lockup svg` main stroke `rgb(250, 35, 59)` (accent), favicon rewritten to a `data:image/svg+xml` tinted with the accent | accent-aware |
| V4 | PASS | full player type | title 28px / weight 800 / -0.024em tracking, artist in accent red (verified earlier this session via computed styles) | Apple Music player type |
| V5 | PASS | bottom tab bar — mobile 390×844 | `position: fixed`, bottom 8px, rect y 814–878 inside 886px viewport, 5 tabs, red active state; was broken (page-flow y≈10023) — fixed in commit `cf3d986` and re-verified | on-screen |
| V6 | PASS | dock vs tab bar | dock is `position: fixed` above the nav (nav top 814; dock clears it; earlier verified `dockAboveNav: true` while playing) | no overlap |
| V7 | PASS | AutoMix overlay | forced at progress 0.55: outgoing opacity 0.45 (1−p), scale 1.077 (1+0.14p), blur 5.5px (10p); incoming opacity 0.3025 (p²); pill "AutoMix" + ring visible; ring reads `--transition-progress: 0.55` | matches the audio's equal-power curve |
| V8 | PASS | queue divider | `.queue-transition-divider` renders between current and next track with the "Transition" label (skipped for same-album pairs by design) | Apple-style marker |
| V9 | PASS | touch targets — /library mobile | 2 elements under 32px: a 14px-high text link ("Listening history") and a 28px row link ("Manage storage and backups") — text links, not primary controls | P2 |
| V10 | PASS | overflow | `/` 5px, `/search` 64px (scrollbar-gutter of a clipped shelf; no unclipped element escapes the viewport — verified per-element), all other routes 0px at desktop; `/library` mobile 19px (shelf scrollbar reserve) | P2 cosmetic |
| V11 | PASS | theme | light-theme token block present (`:root[data-theme='light']`), surfaces and player veil covered | both themes styled |

## Evidence

- Screenshots saved during the audit: `/opt/data/cache/scratch/am-home.png`, `/opt/data/cache/scratch/am-fullplayer-blend.png`
- All measurements taken via `getBoundingClientRect` / `getComputedStyle` in the automation Chromium; that browser cannot decode AAC (media elements throw browser-side URL-safety/format errors), so audio decode itself was verified server-side (see WORKING-AUDIT W6/W7).

## P2 queue (non-blocking)

- V-P2-1: grow the two small text links on the library page to ≥32px hit height.
- V-P2-2: silence the shelf scrollbar-gutter overflow on /search (desktop) and /library (mobile) with `scrollbar-gutter: stable` or overflow clip.
