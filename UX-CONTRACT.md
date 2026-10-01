# Aurora interaction contract

The existing stores and routes own playback, playlists, and saved music. UI changes must reuse those actions and preserve the same track IDs and local playlist data.

## Studio

| Action | Pending | Success | Failure |
| --- | --- | --- | --- |
| Generate mix | Keep the prompt and block duplicate submit | Show real catalog songs as a selectable preview | Keep the prompt, show the reason; if anonymous AI is limited, label catalog-only results |
| Save new mix | Disable save until completion | Navigate to its local playlist | Keep the preview and selected songs |
| Extend playlist | Preserve target and selection | Show count added and a link to the playlist | Keep preview for retry; do not add duplicates |
| Ask Aurora | Keep the question in the conversation and announce progress | Show answer with source links or playable track actions | Keep conversation, show inline error and allow a new request |

## Collection pages

| Page | Primary content | Library action | Playback |
| --- | --- | --- | --- |
| Album | Release artist, year, track order, and full run time | Save or remove the album from the Albums library | Play and shuffle only the album tracks, in album order by default |
| Artist | Up to ten popular songs, followed by separate album and release shelves | Follow or unfollow the artist in the Artists library | Play or shuffle the popular songs as one queue |
| Playlist | Owner/description, song count, run time, and ordered tracks | Local playlists can be edited; remote playlists can be saved as a local copy | Keep the playlist as the queue context; local track menus can remove songs |

Track credits link to their artist and album pages without changing the play control. Album, artist, and playlist shelves remain separate from their main track list so tracks never appear twice.

## Spatial audio

| Action | Pending | Success | Failure |
| --- | --- | --- | --- |
| Enable 8D audio | Keep the chosen motion and mix controls available | Apply live panning, stereo width, and room reverb through the shared player | Keep standard playback available and explain when audio capture is unsupported |
| Add a local audio file | Keep the player responsive during import | Store the file locally and start it in the shared player | Explain which audio formats are accepted |
| Record processed audio | Require active playback and capture the live output | Download the processed recording | Explain when browser recording is unavailable or fails |
| Save a sound recipe | Keep the entered name while editing | Store the recipe on this device and make it selectable | Keep the unsaved mix available |

## Navigation and controls

- Home discovery shelves load near the viewport and reuse the shared catalog query cache. Each shelf has its own retry/empty state, playable queue context, and a More link that preserves the search type. Saved music remains usable if online discovery fails.
- The full player keeps progress, volume, transport, liked state, synced lyric seeking, and queue actions in the shared playback store. Options reveals speed, seek shortcuts, sleep, sound, sharing, and next-track controls. The disclosure participates in the modal keyboard focus loop.

- `src/components/AppShell.tsx` owns desktop and mobile navigation. AI Studio is `/ai`; Audio Studio is `/audio-studio`; local playlists live under `/playlist/local/:id`.
- `src/styles.css` owns global scrollbar, focus, button and navigation treatments. `src/pages/AiPage.css` owns Studio-specific artwork and layout only.
- Native `<select>` owns playlist choice, native `<textarea>` owns the mood prompt, and native checkboxes own preview selection. All retain labels and visible keyboard focus.
- Route changes do not erase local saved playlists. The player and bottom navigation must not hide the Studio's main action on phone screens.
- The app does not claim an AI result when it shows catalog fallback. Public page links and sources open in separate tabs without sending saved library data.
