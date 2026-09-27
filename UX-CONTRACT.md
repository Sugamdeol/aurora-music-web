# Aurora interaction contract

The existing stores and routes own playback, playlists, and saved music. UI changes must reuse those actions and preserve the same track IDs and local playlist data.

## Studio

| Action | Pending | Success | Failure |
| --- | --- | --- | --- |
| Generate mix | Keep the prompt and block duplicate submit | Show real catalog songs as a selectable preview | Keep the prompt, show the reason; if anonymous AI is limited, label catalog-only results |
| Save new mix | Disable save until completion | Navigate to its local playlist | Keep the preview and selected songs |
| Extend playlist | Preserve target and selection | Show count added and a link to the playlist | Keep preview for retry; do not add duplicates |
| Ask Aurora | Keep the question in the conversation and announce progress | Show answer with source links or playable track actions | Keep conversation, show inline error and allow a new request |

## Navigation and controls

- `src/components/AppShell.tsx` owns desktop and mobile navigation. The Studio route is `/ai`; local playlists live under `/playlist/local/:id`.
- `src/styles.css` owns global scrollbar, focus, button and navigation treatments. `src/pages/AiPage.css` owns Studio-specific artwork and layout only.
- Native `<select>` owns playlist choice, native `<textarea>` owns the mood prompt, and native checkboxes own preview selection. All retain labels and visible keyboard focus.
- Route changes do not erase local saved playlists. The player and bottom navigation must not hide the Studio's main action on phone screens.
- The app does not claim an AI result when it shows catalog fallback. Public page links and sources open in separate tabs without sending saved library data.
