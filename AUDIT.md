# Aurora Music Web — Full Audit Report

**Date:** 2026-09-28 · **Code:** `main` @ `ee1a5eb` · **Method:** 4 parallel deep audits (UI/CSS, frontend logic, server, product/docs) + manual core review + full test-suite run

**Overall verdict:** unusually complete and thoughtfully built for a solo project — synced lyrics with per-track offsets, dual-deck crossfades, Media Session, EQ, rooms, sync all exist and mostly work. The debt is concentrated in: **one stream-recovery time bomb, a dead service worker the UI claims is live, missing CI, an undocumented third-party room server, and GPU-heavy glass styling.** Nothing here is architecturally wrong; everything is fixable in small patches.

---

## Health check

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ Clean |
| `npx vitest run` | ⚠️ 72/73 pass. `home-experience.test.tsx › saves the displayed daily mix` **passes alone, fails in full suite** — the save flow takes ~890 ms against a 1000 ms `findBy` default and times out under parallel load. Fix: `await screen.findByRole(..., { timeout: 3000 })` or raise `testTimeout` in `vite.config.ts` |
| `test:integration` script | ❌ Points at nonexistent `tests/integration` dir |
| CI (GitHub Actions) | ❌ None — nothing runs tests on push |
| License / releases | ❌ None |

---

## P0 — Fix these first (bugs & broken promises)

1. **Stream-URL time bomb.** `src/lib/api.ts:245` — `streamCandidates()` returns `[track.streamUrl]` alone when set; `src/store/playback.ts:63-72` persists full tracks (including `streamUrl`) to IndexedDB. YouTube URLs expire in hours, so a restored queue dies on restart with "This track could not be played" that Retry can never fix. *Fix:* strip `streamUrl` in `persist()` (sync.ts:38 already does this for cloud sync — same reason), and always append `/api/v1/stream/:id` as a fallback candidate.

2. **Service worker is never registered, but Settings says "Offline shell — Available".** `public/sw.js` is fully written (shell/static/artwork caches, versioning, update messaging); no `serviceWorker.register()` exists anywhere in `src/`. `SettingsPage.tsx:25,238` reports browser support as app capability. *Fix:* register in `main.tsx` (~5 lines), wire `AURORA_SW_UPDATE_AVAILABLE` to your toast, add 192/512 PNG icons to `manifest.webmanifest` (SVG-only icons weaken installability), or honestly flip the tile to "Not enabled".

3. **Production streaming likely broken: YouTube bot-gating unmitigated.** Code supports `YT_DLP_COOKIE_FILE` (`server/services/ytdlp.ts:216-230`) and `YOUTUBE_SIGN_IN.md` documents why, but `render.yaml` wires neither a secret file nor the env var. Render’s datacenter IPs → "Sign in to confirm you're not a bot" on a large share of videos. *Fix:* Render Secret File + env in the blueprint; map 403/429 to `RATE_LIMITED` with `Retry-After`.

4. **Sleep timer unreliable in background tabs.** `Player.tsx:226-239` uses one long `setTimeout`; frozen/throttled tabs overshoot by minutes — the one feature whose whole point is firing while the screen is off. *Fix:* keep `sleepEndsAt`, check `Date.now()` on a 15 s interval. Also not persisted across reload.

5. **UID of trust: sync session secret = storage API key.** `server/routes/sync.ts:48-49` — `cookieSecret()` returns `MANTLEDB_KEY`; forging any user's session and reading/writing all users' sync data are the same credential. Sync `/data` endpoints also have no rate limit (`authLimit` covers register/login only) and each PUT fans out to two MantleDB calls. *Fix:* separate `SYNC_SESSION_SECRET`, 60/15m limiter on `/data`.

6. **Row context menus can render under the player dock — visually blurred and unclickable.** `.row-menu` z-index 70 vs `.player-dock` 80 / `.bottom-nav` 90 (styles.css:164/523/668). *Fix:* z ≥ 100, or move menus into top-layer `<dialog>`/popover (also gets you Escape + focus handling free).

7. **First-run dead end: "Play next" on empty queue shows a paused player.** `playback.ts:208 addToQueue` sets a current track without `isPlaying` — the user's very first interaction can be silence with no explanation. *Fix:* when `currentIndex === -1`, start playback.

8. **Pin yt-dlp.** `requirements.txt` has `yt-dlp[default]>=2026.8.19`; every Render rebuild rolls the dice on a weekly-churning tool. Pin `==` + upgrade deliberately.

---

## P1 — Reliability & correctness

**Playback / queue**
- **No gapless when crossfade is off** — `prepareNext` bails when `transitionMode === 'off'` (`playbackEngine.ts:294`), so the next track only starts loading at `ended`. The deck infra already exists: always *prepare*, only *mix* when enabled.
- **Prepared deck goes stale on queue mutations** — `preparationKey` lacks queue identity; reordering/removing other items can crossfade into the wrong song. Include a queue fingerprint (head+tail ids + length); re-resolve `prepared.index` by track id at transition time.
- **Queued seek during track load is dropped** — seek throws "metadata not ready", gets swallowed (`playbackEngine.ts:142,180`); playback starts at 0. Keep a `pendingSeek` applied on `loadedmetadata`. (Also needed for resume-where-you-left-off.)
- **Resume position isn't persisted** — `persist()` saves queue/index not `position`; HomePage advertises "X into this track" it can't deliver.
- **Shuffle has no history** — `previous()` under shuffle walks `currentIndex - 1`, not what you heard; `prepareNext` may pre-mix a different random track than `next()` picks.
- **Shuffle + room seek spam** — seek slider broadcasts a `seek` WS message per `input` tick during drags (`Player.tsx:29,89,298`). Throttle or send on release.
- **`stop()` teardown incomplete** — doesn't set `destroyed`, doesn't pause audio, never removes element listeners; leaks AudioContext on HMR/tests.
- **Volume slider dead on iOS when Web Audio fails** — silent fallback to `audio.volume`, which iOS ignores. Detect and disable-with-note.

**Rooms**
- **Raw client clocks decide guest position** (`room/client.ts:98,154`) — devices with clock skew land seconds-to-minutes off. Estimate a server-time offset once via ping/RTT and reuse.
- **No auto-reconnect** — socket close = silent dump to `disconnected`. Exponential-backoff rejoin preserving room code/role (server already emits `user_reconnected`/`host_changed`).
- **`suppressBroadcast` 250 ms window eats real host actions** — pause-then-play within the window never broadcasts; `applySnapshot` on join isn't wrapped, so a participant-control guest echoes events back on join. Replace the timer with an application counter; emit a trailing broadcast.
- **`join_room` "waiting" has no timeout/cancel.**

**Sync / data**
- **No delete tombstones + push-only after boot** — a playlist deleted on device A resurrects from cloud on B; long-lived tabs never pull other devices' changes. Union-merge isn't a sync strategy, it's an undo machine.
- **Dead eligibility filter** — `sync.ts:46` `(... || track.id)` is always truthy; everything syncs, then `.slice(0, 500)` silently truncates.
- **Playlist join positions collide** — `library.ts:160` uses in-memory length as position; after removals, adds collide and `sortBy('position')` mis-orders. Compute `max(position)+1` in the transaction + make the index unique.
- **History/stats scale linearly forever, polled** — StatsPage re-`toArray()`s all history every 6 s, HistoryPage every 15 s with an unstable query key. Cap retention (90 d), range-query by `playedAt`, consider dexie-react-hooks.
- **Library read-then-write races** in `toggleLike`/`recordPlay` (reads outside transactions).
- **`importLibrary` is O(n) sequential** — a 500-track backup visibly janks; reuse sync's bulk pattern.

**Server**
- **Audio-URL cache capped at 3 min despite ~6 h signed URLs** (`ytdlp.ts:116-127` — the `Math.min(fallback, expires-30s)` can only shorten, never extend). Serial yt-dlp runs re-execute constantly.
- **Immutable caching never applies** — `app.ts:57-63` tests the content-type regex before the fingerprint pattern, so hashed `index-*.js` gets `no-cache`.
- **No catalog caching / herd guard** — only `/home` (5 min) and lyrics cached; concurrent `/home` misses all call YouTube; search/entity routes hit upstream every time.
- **Timeout budgets inconsistent** — queue wait 45 s + extraction 60 s vs 25 s route timeout; requests outlive their own 504 and still burn YouTube quota.
- **yt-dlp timeout kills only the Python child** — the Node EJS-solver grandchild is orphaned; killed extractions leak processes. Nothing drains on SIGTERM.
- **`/stream` 90 req/15m per IP counts every range GET** — a single active listener (or NAT- shared campus exit) can self-DoS mid-playlist. Key stream limiting on IP+track or raise substantially.
- **`/api/sync` compat mount can never authenticate** — cookie path is `/api/v1/sync` (`sync.ts:52`); every request to the compat mount 401s. Delete the mount.
- **No mid-stream stall watchdog** — a frozen googlevideo socket holds the slot ~5 min (undici default). Abort on no-chunk ~15 s; the browser Range-retries.

---

## P1 — UI / accessibility (verified against files)

- **backdrop-filter on nearly every button** (`styles.css:802-806` — universal blur wash) + multiple simultaneous full-viewport blur layers (`.song-ambient` 105 px fixed + dock `::before` + every `.glass-surface` + `.player-ambient` 112 px in full player). This is the app's dominant GPU/battery cost. Keep blur on structural glass only; pre-blur artwork once on canvas for ambient tints; auto-enable a perf tier from `prefers-reduced-transparency`/`deviceMemory`.
- **Search combobox is keyboard-dead** — `SearchPage.tsx:123-129`: ARIA combobox/listbox declared, no arrow-key handling, and a 130 ms blur timeout unmounts the list before Tab lands. Implement the pattern (`aria-activedescendant`) or drop the roles.
- **Modal layers don't inert the background; most lack Escape.** Sheets opened from the dock while the full player is closed have *no* Escape path (the handler lives inside `FullPlayer`). One shared `useDialog` hook (focus trap / Escape / restore / `inert`) fixes this, the row-menu semantics, and click-outside in one pass.
- **Partial tablist ARIA** in Search/Library/Stats (no arrow keys, no tabpanels) — downgrade to `role="group"` + `aria-pressed`, or implement fully. Pick one pattern; `AiPage.tsx:75` already does it right.
- **Dock + full player mount duplicate "Track progress"/"Volume" sliders** in the a11y tree — inert the dock while `fullPlayerOpen`.
- **Touch targets as small as 28–32 px** on core transport controls (dock prev/next, lyric timing ±, playlist move) — WCAG floor is 24, platform norm 44–48. Expand hit area visually-cheaply via `::after { inset: -6px }`.
- **Lime accent text ≈1.2–1.6:1 contrast in light theme** (`styles.css:1026`, `refinements.css:99`…) and `--quiet` gray ≈4.0:1 — needs a per-theme `--accent-ink-text` and a slightly darker `--quiet`.
- **Stats chart bars are 30+ focusable no-op `<button>`s** — use `div role="img" aria-label` (the table alternative already exists).
- **Dead CSS ~15–20 % of styles.css**: three generations of the dock (5 definitions across 3 files), an entire superseded violet theme block (`styles.css:746-795`) still tinting lines lavender, orphaned `.mini-progress-*`/`.editorial-*`/`.dock-time`, unused radius tokens, double-defined `.track-actions`.
- **Fonts via render-blocking `@import`** — move to `<link rel="preload" as="font">` for the two woff2 files.
- **Library Albums/Artists cards have zero CSS** (`library-group*` selectors match nothing) — that tab renders unstyled.
- **index.html**: `color-scheme: dark` contradicts the light theme; theme-color `#090b09` ≠ manifest `#0b0d0b`; no og:/twitter: meta (all shared song links unfurl blank); no `apple-touch-icon`; no preconnect to `i.ytimg.com`.
- **`?`-shortcut cheatsheet**: shortcuts exist (Ctrl+K/Space/arrows/M), documented only in `.player-keyboard-hint`, which is permanently `display:none` (`player-polish.css:86`).

## UX-contract violations (from your own UX-CONTRACT.md)

1. AI catalog-fallback renders with `className="ai-success"` — a degradation wearing success styling (`AiPage.tsx:90`).
2. Tablist/menu/combobox roles without the keyboard behavior (above).
3. "Offline shell: Available" while unregistered (P0 #2).
4. "Play next" as first interaction dead-ends (P0 #7).
5. Invite flow: `room/:roomCode` route exists, but the UI only offers "Copy code" — guests retype 6 chars instead of tapping a link.

*(Don't-change list: live regions, skip link, reduced-motion honored in CSS+JS, forced-colors fallback, chart table alternative, prompt preserved + duplicate-submit blocked during AI generation, `rel="noopener"` on external links.)*

---

## Strategic decision needed

**Rooms ride a hardcoded third-party WS server** (`wss://metroserverx.meowery.eu/ws`, `room/client.ts:178`) whose server code isn't in this repo and README never mentions. The `ws` dependency in package.json is unused server-side. (Correction to one audit claim: modern browsers treat `wss:` as matching `https:` in CSP `connect-src`, so rooms are *not* CSP-blocked — but every room's playback state and chat flows through infrastructure you don't control.) Decide: host the WS in this backend (token auth tied to sync sessions, room ACLs, message caps — Moderate effort) or document the external dependency and make it opt-in.

---

## Top improvement roadmap (UI + features), ranked

| # | Improvement | Effort | Why |
|---|---|---|---|
| 1 | **Register SW + raster icons** | S | All the caching code is already written; turns the PWA from claimed to real |
| 2 | **Offline downloads for streamed tracks** | M–L | `db.files` blobs + local-source playback + `/stream` endpoint all exist — a "Keep offline" toggle on liked/playlist tracks is transformative for a phone player |
| 3 | **Resume where you left off** | S | Persist throttled `position`; engine's seek logic already tolerates it (needs the pendingSeek fix) |
| 4 | **Room invite links + reconnect** | S/M | Route exists; copy-link button + auto-join + backoff rejoin turns rooms from demo into product |
| 5 | **Fix play-next-when-idle** | S | First-impression bug |
| 6 | **Explore page categories** | S | `/api/v1/explore` returns `categories`; the page never renders them — ship or delete |
| 7 | **Shortcut help overlay (`?`)** | S | Strings already written |
| 8 | **Follow artists/albums** (saved entities, not derived from history) | M | `artistId`/`albumId` already on every track |
| 9 | **Queue + position sync across devices** | M | MantleDB sync carries settings today; "continue on my laptop" is highest-magic feature on existing rails |
| 10 | **GitHub Actions CI** (typecheck + vitest + flaky-test timeout fix) | S | Nothing runs on push today |
| 11 | **True shuffle with history** | M | `shuffledTracks` helper exists in collections.ts |
| 12 | **YouTube likes as durable collection** | M | Today: 30 liked *videos* fetched, used as mix seeds, discarded on reload |
| 13 | **Now-playing bars animation + dock→full-player FLIP morph + swipe-down close** | S/M | Grabbable "felt polish"; wave keyframes already exist (`styles.css:616`) |
| 14 | **Cross-tab coordination via BroadcastChannel** | M | Two tabs currently clobber each other's audio and persisted queue; capability already advertised |
| 15 | **Lib-scoped search includes playlists**; monthly shareable "wrapped" card (canvas + `navigator.share`); buffered-range seekbar spine; artwork `srcset` (120/544/1088); **AI DJ mode in AgentPanel** ("play something like X" executed against stores, keyless) | S–M | High polish-per-effort |
