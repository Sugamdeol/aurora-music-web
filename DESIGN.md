---
version: alpha
name: Aurora Music Web
description: A personal listening room with a tactile music studio for discovery.
colors:
  background: "#090b09"
  surface: "#101310"
  surface-raised: "#151915"
  ink: "#f6f7f5"
  muted: "#a6aaa5"
  accent: "#8aff18"
  danger: "#ff6e75"
typography:
  display:
    fontFamily: "Manrope, sans-serif"
  body:
    fontFamily: "DM Sans, system-ui, sans-serif"
rounded:
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
spacing:
  page-max: "1180px"
components:
  button: {}
  card: {}
  field: {}
---

# Aurora design

## Overview

Aurora is a personal music player for phone and desktop. A listening room and the physical record sleeve guide the look: near-black surfaces, quiet borders, large album artwork, and one bright lime action at a time. The AI studio uses a vinyl record as its signature object. The Audio Studio uses a live listening field to show sound moving between the speakers, with its controls kept beside the field. The rest of the app stays focused on tracks and playback.

The product is English-first and supports multilingual music names. On mobile, listeners should reach the primary action without losing it under the player or the bottom navigation. Avoid generic neon gradients, oversized explanatory paragraphs, and repeated rows of pills.

Collection pages each have their own reading order: albums foreground release art and track order, artists lead with popular songs and browseable releases, and playlists make owner, duration, and track editing visible. Keep related shelves outside the main track list, and retain working links between artist and album credits.

## Token ownership

The existing `:root` variables in `src/styles.css` own the runtime colors, type families, and radii. This file records their intent and exact accepted values; do not duplicate them as a second CSS theme. The AI and audio studios consume those shared tokens in their page styles. The AI studio's olive record artwork and the audio studio's listening field are page-level illustrations, not new global color tokens.

## Layout and type

The shell keeps its desktop rail and mobile bottom navigation. Content uses the existing page width, with a two-column studio at larger sizes and a compact stacked layout on phones. Manrope carries titles, DM Sans carries controls and prose. Short uppercase labels identify music metadata, while actions use sentence case.

## States and controls

Primary actions use `--accent`, secondary actions use bordered dark surfaces, and focus uses the existing visible accent outline. Selected tabs and modes change both fill and text, not color alone. Disabled and pending actions retain their dimensions. Form errors appear beside the task; catalog fallback is labeled clearly. On reduced motion settings, decorative movement stops. Preview songs can be deselected before saving. Source links in Ask Aurora stay visible and tappable.

## Do and don't

- Do place playable tracks, saved playlists, and search actions above decoration.
- Do keep spatial motion, width, and room controls labelled by what a listener hears.
- Do preserve the user's draft and current screen if an AI request fails.
- Don't promise AI output when the app is showing catalog-only fallback results.
- Don't animate the listening field when reduced motion is enabled.
- Don't hide the main action below multiple stacks of filters or chips on a phone.
