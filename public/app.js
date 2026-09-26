const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const store = {
  read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(`aurora.${key}`)) ?? fallback; }
    catch { return fallback; }
  },
  write(key, value) {
    try { localStorage.setItem(`aurora.${key}`, JSON.stringify(value)); }
    catch { notify('Browser storage is full. Export your library, then clear older data.'); }
  },
};

const iconPaths = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  library: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  'folder-plus': '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v6m-3-3h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1a1.8 1.8 0 1 1-2.5 2.5l-.1-.1a1.8 1.8 0 0 0-3 .9v.2a1.8 1.8 0 1 1-3.6 0v-.2a1.8 1.8 0 0 0-3-.9l-.1.1a1.8 1.8 0 1 1-2.5-2.5l.1-.1a1.8 1.8 0 0 0-.9-3H3.8a1.8 1.8 0 1 1 0-3.6H4a1.8 1.8 0 0 0 .9-3l-.1-.1a1.8 1.8 0 1 1 2.5-2.5l.1.1a1.8 1.8 0 0 0 3-.9v-.2a1.8 1.8 0 1 1 3.6 0V2a1.8 1.8 0 0 0 3 .9l.1-.1a1.8 1.8 0 1 1 2.5 2.5l-.1.1a1.8 1.8 0 0 0 .9 3h.2a1.8 1.8 0 1 1 0 3.6h-.2a1.8 1.8 0 0 0-.9 3Z" transform="translate(1.4 1.4) scale(.88)"/>',
  'sun-moon': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  'list-music': '<path d="M16 8V5l5-1v12"/><circle cx="14" cy="17" r="2"/><circle cx="19" cy="16" r="2"/><path d="M3 9h8M3 13h8M3 17h5"/>',
  'align-left': '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  volume: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7m3-10a9 9 0 0 1 0 13"/>',
  'volume-x': '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6m0-6-5 6"/>',
  'skip-back': '<path d="M19 20 9 12l10-8z"/><path d="M5 19V5"/>',
  'skip-forward': '<path d="m5 4 10 8-10 8z"/><path d="M19 5v14"/>',
  shuffle: '<path d="m18 14 4 4-4 4m0-20 4 4-4 4M2 18h2.5a6 6 0 0 0 4.2-1.7l6.6-6.6A6 6 0 0 1 19.5 8H22M2 6h2.5a6 6 0 0 1 4.2 1.7M14 14l1.5 1.5A6 6 0 0 0 19.5 18H22"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  play: '<path d="m8 5 12 7-12 7z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5h3v14H8zM15 5h3v14h-3z" fill="currentColor" stroke="none"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="m18 6-12 12M6 6l12 12"/>',
  ellipsis: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  'folder-open': '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 12h18"/>',
  'disc-3': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/><path d="M4.9 4.9 9 9m6 6 4.1 4.1"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  sparkles: '<path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-2-5.8L4 11l6-2.2z"/><path d="m19 14 1.2 2.8L23 18l-2.8 1.2L19 22l-1.2-2.8L15 18l2.8-1.2z"/>',
  'arrow-up-right': '<path d="M7 17 17 7M7 7h10v10"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  'more-horizontal': '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  'arrow-left': '<path d="m12 19-7-7 7-7M5 12h14"/>',
  'external-link': '<path d="M15 3h6v6M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  'check-circle': '<path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><path d="m9 11 3 3L22 4"/>',
};

function icon(name, className = '') {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.music}</svg>`;
}
function installStaticIcons() {
  $$('[data-icon]').forEach((element) => { element.innerHTML = icon(element.dataset.icon); });
}

const audio = $('#audio');
const state = {
  view: 'home', query: '', searchType: 'song', results: [], searching: false, requestId: 0,
  homeSections: [], homeLoading: false, homeError: '',
  queue: store.read('queue', []), index: store.read('index', -1), playing: false,
  relatedLoadedFor: '', relatedLoadingFor: '', relatedPromise: null, relatedTracks: [], relatedError: '',
  recent: store.read('recent', []), liked: store.read('liked', []), playlists: store.read('playlists', []),
  recentSearches: store.read('searches', []), libraryTab: 'Recent', shuffle: store.read('shuffle', false),
  repeat: ['off', 'all', 'one'].includes(store.read('repeat', 'off')) ? store.read('repeat', 'off') : 'off', currentPlaylist: null, detail: null, pendingTrack: null,
  room: { socket: null, status: 'disconnected', role: '', code: '', userId: '', username: store.read('roomUsername', 'Sugam Deol'), server: store.read('roomServer', 'wss://metroserverx.meowery.eu/ws'), users: [], requests: [], messages: [], error: '', allowControl: false, suppressBroadcast: false },
  localSongs: [], localUrls: new Map(), mediaSessionReady: false,
};
const audioDatabase = openAudioDatabase();

function openAudioDatabase() {
  return new Promise((resolve) => {
    if (!('indexedDB' in window)) return resolve(null);
    const request = indexedDB.open('aurora-music-library', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('audio', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}
function dbRequest(mode, operation) {
  return audioDatabase.then((db) => new Promise((resolve) => {
    if (!db) return resolve(null);
    const request = operation(db.transaction('audio', mode).objectStore('audio'));
    request.onsuccess = () => resolve(request.result ?? true);
    request.onerror = () => resolve(null);
  }));
}

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function current() { return state.queue[state.index] || null; }
function durationText(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
function notify(message) {
  const old = $('.toast'); old?.remove();
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = message;
  $('#toast-region').append(el); setTimeout(() => el.remove(), 2800);
}
function setService(message, tone = 'ready') {
  $('#service-status').textContent = message;
  $('#service-status').dataset.tone = tone;
  $('.sidebar-bottom .live-dot').dataset.tone = tone;
}
function artworkUrl(source = '') {
  if (!source || source.startsWith('/') || source.startsWith('blob:')) return source || '/aurora.svg';
  try {
    const url = new URL(source);
    if (url.hostname.endsWith('googleusercontent.com')) url.pathname = url.pathname.replace(/=(?:w\d+-h\d+|s\d+)[^/]*$/, '=w1200-h1200-l90-rj');
    else if (url.hostname.endsWith('ytimg.com')) url.pathname = url.pathname.replace(/\/(?:default|mqdefault|hqdefault|sddefault)\.(jpg|webp)$/i, '/maxresdefault.$1');
    return url.href;
  } catch { return source; }
}
function trackImage(track, className = '') {
  const original = track.thumbnail || '/aurora.svg';
  return `<img class="${className}" src="${esc(artworkUrl(original))}" data-fallback-src="${esc(original)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-art-fallback>`;
}
document.addEventListener('error', (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.hasAttribute('data-art-fallback')) return;
  const fallback = image.dataset.fallbackSrc;
  if (fallback && image.src !== new URL(fallback, location.href).href) image.src = fallback;
  else { image.removeAttribute('data-art-fallback'); image.classList.add('image-failed'); }
}, true);
function isLiked(track) { return state.liked.some((item) => item.id === track?.id); }
function findTrack(id) {
  return [
    ...state.results, ...state.recent, ...state.liked, ...state.localSongs, ...state.queue,
    ...(state.currentPlaylist?.tracks || []), ...(state.detail ? entitySongs() : []),
  ].find((item) => item?.id === id) || null;
}
function navSelection(view) {
  $$('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
}
function setView(view) {
  state.view = view; state.detail = null; state.currentPlaylist = null;
  navSelection(view);
  renderView();
  if (view === 'search') setTimeout(() => $('#query')?.focus({ preventScroll: true }), 40);
  $('#view').focus({ preventScroll: true });
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning, Sugam' : hour < 18 ? 'Good afternoon, Sugam' : 'Good evening, Sugam';
}
function homeView() {
  const recent = state.recent.slice(0, 6);
  const playlists = state.playlists.slice(0, 8);
  const firstFeed = state.homeSections.find((section) => section.items.some((item) => item.type === 'playlist'));
  const featured = firstFeed?.items?.[0];
  const taste = state.homeSections.slice(0, 4);
  return `<div class="home-page">
    <div class="home-greeting"><div><div class="eyebrow">YOUR MUSIC, IN GOOD LIGHT</div><h1 class="page-heading">${greeting()}</h1></div><button class="round-cta" data-view="search" aria-label="Explore music">${icon('arrow-up-right')}</button></div>
    <section class="section continue-section"><div class="section-head"><div><div class="section-overline">PICK UP WHERE YOU LEFT OFF</div><h2 class="section-title">Continue listening</h2></div><button class="section-link" data-view="library">History ${icon('arrow-up-right')}</button></div>
      ${recent.length ? `<div class="continue-row">${recent.map((track) => `<button class="continue-card" data-play="${esc(track.id)}" data-from="recent">${trackImage(track, 'continue-art')}<span class="continue-shade"></span><span class="continue-meta"><strong>${esc(track.title)}</strong><small>${esc(track.artist)}</small></span><span class="continue-play">${icon('play')}</span></button>`).join('')}</div>` : `<div class="welcome-listen glass-surface"><div class="welcome-art">${icon('music')}</div><div class="welcome-copy"><strong>Your listening starts here</strong><span>Search for a song and Aurora will keep it close.</span></div><button class="text-action" data-view="search">Find music ${icon('arrow-up-right')}</button></div>`}
    </section>
    <section class="section"><div class="section-head"><div><div class="section-overline">MADE BY YOU</div><h2 class="section-title">Playlists</h2></div><button class="section-link" id="new-playlist-inline">Create playlist ${icon('plus')}</button></div>
      ${playlists.length ? `<div class="playlist-strip">${playlists.map((playlist) => playlistCard(playlist)).join('')}</div>` : `<div class="playlist-create-card"><div class="playlist-create-art">${icon('disc-3')}</div><div><strong>Make room for a new mood</strong><span>Collect the songs you want to come back to.</span></div><button class="primary-button" id="new-playlist-inline">Create playlist</button></div>`}
    </section>
    <section class="feature-banner ${featured?.thumbnail ? 'has-art' : ''}">
      ${featured?.thumbnail ? `<div class="feature-art">${trackImage(featured)}</div>` : ''}<div class="feature-mark">${icon('sparkles')}</div><div class="feature-copy"><div class="eyebrow">A LITTLE DISCOVERY</div><h2>${featured ? esc(featured.title) : 'Find a new favorite'}</h2><p>${featured ? 'A fresh mix, waiting for the right moment.' : 'Start with a mood, artist, or the song on your mind.'}</p><button class="feature-button" ${featured ? `data-open-kind="playlist" data-id="${esc(featured.browseId || featured.id)}"` : 'data-view="search"'}>${featured ? 'Open mix' : 'Explore music'} ${icon('arrow-up-right')}</button></div>
    </section>
    ${recent.length ? `<section class="section"><div class="section-head"><div><div class="section-overline">STILL ON YOUR MIND</div><h2 class="section-title">Recently played</h2></div><button class="section-link" data-view="library">See all ${icon('arrow-up-right')}</button></div><div class="card-grid">${recent.slice(0, 6).map((track) => mediaCard(track, 'song')).join('')}</div></section>` : ''}
    ${taste.map((section) => `<section class="section"><div class="section-head"><div><div class="section-overline">FROM YOUTUBE MUSIC</div><h2 class="section-title">${esc(section.title)}</h2></div></div><div class="media-strip">${section.items.slice(0, 8).map((item) => mediaCard(item, item.type || 'playlist')).join('')}</div></section>`).join('')}
    ${state.homeLoading ? `<section class="section loading-shelf"><div class="section-head"><div class="section-overline">TUNING IN</div><h2 class="section-title">Finding music for the moment</h2></div><div class="skeleton-row">${[1,2,3,4].map(() => '<div class="skeleton-card"></div>').join('')}</div></section>` : ''}
    ${state.homeError && !taste.length ? `<div class="inline-error glass-surface"><div><strong>Discovery couldn’t load</strong><span>${esc(state.homeError)}</span></div><button class="text-action" data-action="retry-home">Try again</button></div>` : ''}
    ${!taste.length && !state.homeLoading ? `<section class="section"><div class="section-head"><div><div class="section-overline">START WITH A FEELING</div><h2 class="section-title">Made for this moment</h2></div></div><div class="mood-grid">${moods.map((mood) => `<button class="mood-card" data-query="${esc(mood.query)}"><span class="mood-icon">${icon(mood.icon)}</span><span>${esc(mood.name)}</span></button>`).join('')}</div></section>` : ''}
  </div>`;
}

const moods = [
  { name: 'Easy listening', query: 'soft indie easy listening', icon: 'sparkles' },
  { name: 'Slow mornings', query: 'slow morning acoustic', icon: 'sun-moon' },
  { name: 'Focus', query: 'instrumental focus', icon: 'disc-3' },
  { name: 'Move', query: 'upbeat workout music', icon: 'music' },
  { name: 'After hours', query: 'late night r&b', icon: 'volume' },
];

function playlistCard(playlist) {
  const first = playlist.tracks?.[0];
  const artwork = first?.thumbnail ? trackImage(first, 'cover-art') : `<span class="cover-placeholder">${icon('music')}</span>`;
  return `<button class="playlist-card" data-playlist-id="${esc(playlist.id)}"><span class="playlist-cover">${artwork}<span class="playlist-cover-icon">${icon('arrow-up-right')}</span></span><strong>${esc(playlist.name)}</strong><small>${playlist.tracks?.length || 0} songs</small></button>`;
}

function mediaCard(item, kind = item.type || 'song') {
  const displayKind = ['artist'].includes(kind) ? 'artist' : ['album'].includes(kind) ? 'album' : ['playlist'].includes(kind) ? 'playlist' : 'song';
  const attributes = displayKind === 'song' || kind === 'video'
    ? `data-play="${esc(item.id)}"`
    : `data-open-kind="${displayKind}" data-id="${esc(item.browseId || item.id)}"`;
  return `<button class="media-card ${displayKind === 'artist' ? 'artist-card' : ''}" ${attributes}>${displayKind === 'artist' ? `<span class="artist-cover">${trackImage(item, 'cover-art')}</span>` : `<span class="media-cover">${trackImage(item, 'cover-art')}<span class="media-play">${icon(displayKind === 'song' ? 'play' : 'arrow-up-right')}</span></span>`}<strong>${esc(item.title)}</strong><small>${esc(item.artist || item.subtitle || (displayKind === 'artist' ? 'Artist' : displayKind))}</small></button>`;
}

function searchView() {
  const types = [['song', 'Song'], ['artist', 'Artist'], ['album', 'Album'], ['playlist', 'Playlist'], ['video', 'Video'], ['local', 'On this device']];
  const history = state.recent.slice(0, 5);
  const recentSearches = state.recentSearches.slice(0, 6);
  return `<div class="search-page">
    <div class="eyebrow">FIND YOUR SOUND</div><h1 class="page-heading">Search</h1><p class="page-subtitle">A song, an artist, an album — start anywhere.</p>
    <form id="search-form" class="search-form glass-surface"><span class="search-symbol">${icon('search')}</span><input id="query" type="search" value="${esc(state.query)}" placeholder="Search songs, artists, albums" autocomplete="off" aria-label="Search music" /><button type="button" class="clear-search ${state.query ? '' : 'hidden'}" aria-label="Clear search" data-action="clear-search">${icon('x')}</button><button class="search-submit" aria-label="Search">${icon('arrow-up-right')}</button></form>
    <div class="filter-row" role="tablist" aria-label="Search category">${types.map(([id, label]) => `<button class="filter-pill ${state.searchType === id ? 'selected' : ''}" data-search-type="${id}" role="tab" aria-selected="${state.searchType === id}">${label}</button>`).join('')}</div>
    <div id="search-results" aria-live="polite">${searchResultArea()}</div>
    ${!state.query ? `<div class="search-discover">
      ${recentSearches.length ? `<section class="search-section"><div class="section-head"><div><div class="section-overline">PICK IT BACK UP</div><h2 class="section-title">Recent searches</h2></div><button class="section-link" data-action="clear-search-history">Clear</button></div><div class="recent-search-list">${recentSearches.map((query) => `<button class="recent-search" data-query="${esc(query)}"><span>${icon('clock')}</span><strong>${esc(query)}</strong>${icon('arrow-up-right')}</button>`).join('')}</div></section>` : ''}
      ${history.length ? `<section class="search-section"><div class="section-head"><div><div class="section-overline">FROM YOUR LISTENING</div><h2 class="section-title">Recently played</h2></div><button class="section-link" data-view="library">See all</button></div><div class="track-list">${history.slice(0, 4).map((track, index) => trackRow(track, index)).join('')}</div></section>` : ''}
      <section class="search-section"><div class="section-head"><div><div class="section-overline">QUICK START</div><h2 class="section-title">Browse by mood</h2></div></div><div class="mood-grid search-moods">${moods.map((mood) => `<button class="mood-card" data-query="${esc(mood.query)}"><span class="mood-icon">${icon(mood.icon)}</span><span>${esc(mood.name)}</span></button>`).join('')}</div></section>
    </div>` : ''}
  </div>`;
}

function searchResultArea() {
  if (state.searching) return `<div class="result-loading"><div class="loading-bars"><i></i><i></i><i></i></div><strong>Finding your sound</strong><span>Searching ${esc(state.searchType)}s for “${esc(state.query)}”</span></div>`;
  if (state.searchError) return `<div class="inline-error glass-surface"><div><strong>Search didn’t finish</strong><span>${esc(state.searchError)}</span></div><button class="text-action" data-action="retry-search">Try again</button></div>`;
  if (state.query && state.results.length === 0) return `<div class="empty-state"><span class="empty-icon">${icon('search')}</span><div><strong>No ${esc(state.searchType)} results</strong>Try a shorter title or a different spelling.</div></div>`;
  if (!state.results.length) return '';
  const cards = ['artist', 'album', 'playlist'].includes(state.searchType);
  return `<div class="results-summary"><span>${state.results.length} ${state.results.length === 1 ? state.searchType : `${state.searchType}s`}</span><button class="text-action" data-action="play-results">Play all ${icon('play')}</button></div>${cards ? `<div class="card-grid search-card-grid">${state.results.map((item) => mediaCard(item, state.searchType)).join('')}</div>` : `<div class="track-list">${state.results.map((item, index) => trackRow(item, index)).join('')}</div>`}`;
}

function trackRow(track, index, options = {}) {
  const liked = isLiked(track);
  const currentId = current()?.id;
  return `<article class="track-row ${currentId === track.id ? 'is-current' : ''}" data-row-id="${esc(track.id)}">
    <button class="track-art-button" data-play="${esc(track.id)}" aria-label="Play ${esc(track.title)}">${trackImage(track, 'track-thumb')}<span class="row-play-icon">${icon(currentId === track.id && state.playing ? 'pause' : 'play')}</span></button>
    <div class="track-info"><button class="track-title-button" data-play="${esc(track.id)}"><strong>${esc(track.title)}</strong></button><span>${track.artistId ? `<button class="inline-link" data-open-kind="artist" data-id="${esc(track.artistId)}">${esc(track.artist)}</button>` : esc(track.artist)}${track.album ? ` <span class="metadata-dot">·</span> ${track.albumId ? `<button class="inline-link" data-open-kind="album" data-id="${esc(track.albumId)}">${esc(track.album)}</button>` : esc(track.album)}` : ''}</span></div>
    <span class="track-duration">${esc(track.duration || '')}</span>
    <div class="row-actions"><button class="like-row ${liked ? 'liked' : ''}" data-like="${esc(track.id)}" aria-label="${liked ? 'Remove from' : 'Add to'} liked songs" title="${liked ? 'Unlike' : 'Like'}">${icon('heart')}</button><button class="play-row" data-play-index="${index}" aria-label="Play ${esc(track.title)}" title="Play">${icon('play')}</button><button class="more-row" data-more="${esc(track.id)}" aria-label="More options" title="More options">${icon('ellipsis')}</button></div>
  </article>`;
}

function libraryView() {
  const tabs = [['Recent', 'Recently played'], ['Liked', 'Liked songs'], ['Playlists', 'Playlists'], ['Local', 'Local music']];
  let content = '';
  if (state.libraryTab === 'Liked') content = state.liked.length ? `<div class="track-list">${state.liked.map((track, index) => trackRow(track, index)).join('')}</div>` : emptyState('Nothing liked yet', 'Tap the heart beside a song to keep it in your library.', 'heart');
  if (state.libraryTab === 'Recent') content = state.recent.length ? `<div class="track-list">${state.recent.map((track, index) => trackRow(track, index)).join('')}</div>` : emptyState('Your listening starts here', 'Songs you play will be waiting here when you come back.', 'clock');
  if (state.libraryTab === 'Playlists') content = state.playlists.length ? `<div class="card-grid library-playlists">${state.playlists.map((item) => playlistCard(item)).join('')}</div>` : emptyState('Make your first playlist', 'Collect tracks for a mood, a trip, or a day you want to remember.', 'disc-3', '<button class="primary-button" id="new-playlist-inline">Create playlist</button>');
  if (state.libraryTab === 'Local') content = state.localSongs.length ? `<div class="local-library-head"><span>${state.localSongs.length} files stored in this browser</span><label class="text-action" for="local-files">Add music ${icon('plus')}</label></div><div class="track-list">${state.localSongs.map((track, index) => trackRow(track, index)).join('')}</div>` : emptyState('Bring your own music', 'Import audio files from this device. Aurora keeps them in this browser only.', 'folder-open', '<label class="primary-button file-picker" for="local-files">Choose audio files</label>');
  return `<div class="library-page"><div class="eyebrow">YOUR MUSIC, YOUR WAY</div><h1 class="page-heading">Your library</h1><p class="page-subtitle">The songs and playlists you have made your own.</p><button class="text-action library-settings-link" data-view="profile">Settings and backup ${icon('arrow-up-right')}</button>
    <div class="library-highlights"><button class="library-feature liked-feature" data-library-tab="Liked"><span class="feature-icon">${icon('heart')}</span><span><strong>Liked songs</strong><small>${state.liked.length} tracks you love</small></span>${icon('arrow-up-right')}</button><button class="library-feature recent-feature" data-library-tab="Recent"><span class="feature-icon">${icon('clock')}</span><span><strong>Recently played</strong><small>${state.recent.length} tracks in your history</small></span>${icon('arrow-up-right')}</button></div>
    <div class="library-tabs" role="tablist">${tabs.map(([id,label]) => `<button class="library-tab ${state.libraryTab === id ? 'active' : ''}" data-library-tab="${id}" role="tab" aria-selected="${state.libraryTab === id}">${label}</button>`).join('')}<button class="library-tab library-add" id="new-playlist-inline">${icon('plus')}<span>New playlist</span></button></div>
    <section class="library-content">${content}</section>
  </div>`;
}

function emptyState(title, description, glyph = 'music', action = '') {
  return `<div class="empty-state"><span class="empty-icon">${icon(glyph)}</span><div><strong>${esc(title)}</strong><span>${esc(description)}</span>${action ? `<div class="empty-action">${action}</div>` : ''}</div></div>`;
}

function profileView() {
  const total = state.recent.length;
  const localSize = state.localSongs.length;
  return `<div class="profile-page"><div class="eyebrow">YOUR AURORA</div><h1 class="page-heading">Your space</h1><p class="page-subtitle">Personal settings stay in this browser.</p>
    <section class="profile-hero glass-surface"><div class="profile-avatar">S</div><div><div class="section-overline">MUSIC, YOUR WAY</div><h2>Sugam Deol</h2><p>Aurora Music creator</p></div><span class="profile-mark">${icon('sparkles')}</span></section>
    <section class="settings-group"><div class="section-overline">APPEARANCE</div><button class="setting-row" data-view="appearance"><span class="setting-icon">${icon('sun-moon')}</span><span><strong>Design style</strong><small>Liquid Glass + Apple Music or Material UI</small></span><span class="setting-value">${document.body.classList.contains('material-style') ? 'Material UI' : 'Liquid Glass'}</span>${icon('arrow-up-right')}</button></section>
    <section class="settings-group"><div class="section-overline">YOUR LIBRARY</div><button class="setting-row" data-view="library"><span class="setting-icon">${icon('library')}</span><span><strong>Listening history</strong><small>${total} recent tracks · ${state.liked.length} liked · ${localSize} local</small></span>${icon('arrow-up-right')}</button><button class="setting-row" data-action="export-library"><span class="setting-icon">${icon('download')}</span><span><strong>Export your library</strong><small>Save playlists, liked songs, and history to a file</small></span>${icon('arrow-up-right')}</button><label class="setting-row import-backup"><span class="setting-icon">${icon('folder-open')}</span><span><strong>Import a backup</strong><small>Restore a library saved from Aurora</small></span>${icon('arrow-up-right')}<input id="backup-file" type="file" accept="application/json,.json" hidden /></label></section>
    <section class="settings-group"><div class="section-overline">ABOUT</div><div class="about-card glass-surface"><img src="/aurora.svg" alt="Aurora Music"/><div><strong>Aurora Music</strong><span>Built around your music. Made by Sugam Deol.</span></div><span class="about-version">WEB</span></div><p class="privacy-note">Your library is saved locally in this browser. Music search and playback need an internet connection.</p></section>
  </div>`;
}

function appearanceView() {
  const material = document.body.classList.contains('material-style');
  return `<div class="appearance-page"><div class="eyebrow">YOUR AURORA</div><h1 class="page-heading">Appearance</h1><p class="page-subtitle">Choose how Aurora feels on this device.</p>
    <div class="appearance-options">
      <button class="appearance-option ${!material ? 'selected' : ''}" data-style="glass"><span class="option-preview glass-preview"><i></i><i></i><i></i></span><span><strong>Liquid Glass + Apple Music</strong><small>Dark, translucent surfaces with Aurora lime.</small></span>${icon('check-circle')}</button>
      <button class="appearance-option ${material ? 'selected' : ''}" data-style="material"><span class="option-preview material-preview"><i></i><i></i><i></i></span><span><strong>Material UI</strong><small>Clear, solid surfaces and familiar controls.</small></span>${icon('check-circle')}</button>
    </div>
    <section class="settings-group"><div class="section-overline">PLAYBACK</div><label class="setting-row"><span class="setting-icon">${icon('volume')}</span><span><strong>Continue with similar music</strong><small>Find related songs when the queue ends</small></span><input type="checkbox" class="toggle-control" id="autoplay-setting" ${store.read('autoplay', true) ? 'checked' : ''}/></label><label class="setting-row"><span class="setting-icon">${icon('music')}</span><span><strong>Crossfade</strong><small>Crossfade is not available in this browser build</small></span><span class="setting-value">Off</span></label></section>
  </div>`;
}

function togetherView() {
  const room = state.room;
  const connected = ['connected', 'waiting'].includes(room.status);
  return `<div class="together-page"><div class="eyebrow">LISTEN TOGETHER</div><h1 class="page-heading">Share the same moment.</h1><p class="page-subtitle">Create a room or join a friend’s queue. Playback stays in sync.</p>
    <section class="together-hero glass-surface"><div class="together-orbit">${icon('users')}</div><div><div class="section-overline">AURORA ROOMS</div><h2>${connected ? (room.role === 'host' ? 'Your listening room' : 'You’re in the room') : 'Music is better shared'}</h2><p>${connected ? `${room.users.length} ${room.users.length === 1 ? 'listener' : 'listeners'} in the room` : 'Use a short room code to listen together in real time.'}</p></div><span class="connection-pill ${connected ? 'connected' : ''}"><i></i>${connected ? 'Connected' : room.status === 'connecting' ? 'Connecting…' : room.status === 'error' ? 'Connection issue' : 'Not connected'}</span></section>
    ${connected ? `<section class="room-live glass-surface"><div class="room-code-block"><div><div class="section-overline">ROOM CODE</div><strong>${esc(room.code || '—')}</strong></div><button class="secondary-button" data-action="copy-room-code">${icon('external-link')} Copy invite code</button><button class="icon-button" data-action="leave-room" aria-label="Leave room">${icon('x')}</button></div>
      <div class="room-current">${current() ? `${trackImage(current(),'room-art')}<div><span class="section-overline">NOW PLAYING</span><strong>${esc(current().title)}</strong><small>${esc(current().artist)}</small></div>` : `<span class="room-art-empty">${icon('music')}</span><div><span class="section-overline">NOW PLAYING</span><strong>Nothing is playing</strong><small>Choose a song and it will sync for everyone.</small></div>`}</div>
      <div class="room-users"><div class="section-overline">LISTENERS</div>${room.users.map((user) => `<div class="room-user"><span class="avatar-mark">${esc((user.username || '?').slice(0,1).toUpperCase())}</span><span><strong>${esc(user.username || 'Listener')}</strong><small>${user.is_host ? 'Host' : 'Listener'}${user.is_connected === false ? ' · reconnecting' : ''}</small></span>${room.userId === user.user_id ? '<span class="you-tag">YOU</span>' : ''}</div>`).join('')}</div>
      ${room.requests.length ? `<div class="room-requests"><div class="section-overline">JOIN REQUESTS</div>${room.requests.map((request) => `<div class="room-user"><span><strong>${esc(request.username)}</strong><small>Would like to join</small></span><button class="text-action" data-room-approve="${esc(request.user_id)}">Approve</button><button class="text-action danger-text" data-room-reject="${esc(request.user_id)}">Decline</button></div>`).join('')}</div>` : ''}
      <form id="room-chat-form" class="room-chat-form"><input name="message" maxlength="500" placeholder="Send a message to the room" aria-label="Message"/><button class="primary-button" type="submit" aria-label="Send message">${icon('arrow-up-right')}</button></form>
      <div class="room-chat">${room.messages.slice(-30).map((message) => `<div class="chat-message"><strong>${esc(message.username)}</strong><span>${esc(message.message)}</span></div>`).join('') || '<p class="chat-empty">Say hello to everyone listening.</p>'}</div>
      <div class="room-footer"><label><input type="checkbox" id="room-participant-control" ${room.allowControl ? 'checked' : ''} ${room.role === 'host' ? '' : 'disabled'}/> Let listeners control playback</label><button class="text-action danger-text" data-action="leave-room">Leave room ${icon('arrow-up-right')}</button></div>
    </section>` : `<div class="together-grid"><article class="together-card glass-surface"><span class="setting-icon">${icon('plus')}</span><h3>Start a room</h3><p>You’ll be the host. Approve listeners, pick the music, and control the queue.</p><form id="room-create-form" class="room-connect-form"><label>Display name<input id="room-username" value="${esc(room.username)}" maxlength="32" autocomplete="nickname" required/></label><button class="primary-button" type="submit" ${room.status === 'connecting' ? 'disabled' : ''}>${room.status === 'connecting' ? 'Connecting…' : 'Create room'}</button></form></article><article class="together-card glass-surface"><span class="setting-icon">${icon('arrow-up-right')}</span><h3>Join a room</h3><p>Enter the code from your friend. The host may need to approve you.</p><form id="room-join-form" class="room-connect-form"><label>Display name<input id="room-join-username" value="${esc(room.username)}" maxlength="32" autocomplete="nickname" required/></label><label>Room code<input id="room-code-input" name="room" placeholder="AB12CD" maxlength="12" autocomplete="off" required/></label><button class="primary-button" type="submit" ${room.status === 'connecting' ? 'disabled' : ''}>Join room</button></form></article></div>
      <details class="room-advanced"><summary>Connection settings</summary><label>Room server<input id="room-server" value="${esc(room.server)}" spellcheck="false"/></label><small>Uses Aurora’s Listen Together server. Messages and room state are relayed through that server.</small></details>${room.error ? `<div class="inline-error glass-surface"><div><strong>Couldn’t connect</strong><span>${esc(room.error)}</span></div><button class="text-action" data-action="dismiss-room-error">Dismiss</button></div>` : ''}`}
  </div>`;
}

function roomSend(type, payload = null) {
  const socket = state.room.socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  try { socket.send(JSON.stringify({ type, payload })); return true; }
  catch { return false; }
}

function roomTrackInfo(track) {
  if (!track || track.local) return null;
  const duration = Number.parseInt(String(track.duration || '').split(':').reduce((total, part) => total * 60 + Number(part), 0), 10) || 0;
  return { id: track.id, title: track.title, artist: track.artist, album: track.album || '', duration, thumbnail: track.thumbnail || '' };
}

function syncQueueToRoom() {
  if (state.room.role !== 'host' && !state.room.allowControl) return;
  const queue = state.queue.map(roomTrackInfo).filter(Boolean);
  roomSend('playback_action', { action: 'sync_queue', queue });
}

function broadcastRoomPlayback(action, extra = {}) {
  const room = state.room;
  if (room.suppressBroadcast || !room.code || (room.role !== 'host' && !room.allowControl)) return;
  const currentTrack = current();
  roomSend('playback_action', {
    action,
    track_id: currentTrack?.id || undefined,
    position: Math.round((audio.currentTime || 0) * 1000),
    server_time: Date.now(),
    ...(action === 'change_track' && currentTrack ? { track_info: roomTrackInfo(currentTrack) } : {}),
    ...extra,
  });
}

function roomSetState(roomState = {}) {
  const room = state.room;
  room.code = roomState.room_code || room.code;
  room.userId = room.user_id || room.userId;
  room.users = roomState.users || room.users;
  room.allowControl = Boolean(roomState.allow_participant_control ?? room.allowControl);
  const remoteQueue = (roomState.queue || []).filter((track) => track?.id).map((track) => ({ ...track, duration: track.duration ? durationText(track.duration) : '' }));
  if (remoteQueue.length) state.queue = remoteQueue;
  const remoteTrack = roomState.current_track;
  if (remoteTrack?.id) {
    const existing = state.queue.findIndex((track) => track.id === remoteTrack.id);
    const track = { ...remoteTrack, duration: remoteTrack.duration ? durationText(remoteTrack.duration) : '' };
    if (existing >= 0) state.index = existing;
    else { state.queue.unshift(track); state.index = 0; }
    state.room.suppressBroadcast = true;
    audio.src = `/api/stream/${encodeURIComponent(track.id)}`;
    const elapsed = Math.max(0, (Date.now() - Number(roomState.last_update || Date.now())) / 1000);
    audio.currentTime = Math.max(0, (Number(roomState.position || 0) / 1000) + (roomState.is_playing ? elapsed : 0));
    if (roomState.is_playing) audio.play().catch(() => {}); else audio.pause();
    setTimeout(() => { state.room.suppressBroadcast = false; }, 300);
  }
  persistQueue(); syncPlayer();
}

function handleRoomMessage(message) {
  const room = state.room;
  const type = message?.type;
  const payload = message?.payload || {};
  if (!type) return;
  if (type === 'room_created') {
    room.code = payload.room_code || '';
    room.userId = payload.user_id || '';
    room.role = 'host'; room.status = 'connected'; room.error = '';
    room.users = [{ user_id: room.userId, username: room.username, is_host: true, is_connected: true }];
    store.write('roomSession', { code: room.code, token: payload.session_token, username: room.username, role: room.role, server: room.server });
  } else if (type === 'join_request') {
    room.requests = [...room.requests.filter((item) => item.user_id !== payload.user_id), payload];
  } else if (type === 'join_approved') {
    room.code = payload.room_code || room.code; room.userId = payload.user_id || '';
    room.role = 'guest'; room.status = 'connected'; room.error = ''; room.requests = [];
    roomSetState(payload.state || {});
    store.write('roomSession', { code: room.code, token: payload.session_token, username: room.username, role: room.role, server: room.server });
  } else if (type === 'join_rejected') {
    room.status = 'error'; room.error = payload.reason || 'The host declined the request.';
  } else if (type === 'user_joined') {
    if (!room.users.some((user) => user.user_id === payload.user_id)) room.users.push({ ...payload, is_connected: true });
  } else if (type === 'user_left' || type === 'user_disconnected') {
    room.users = room.users.map((user) => user.user_id === payload.user_id ? { ...user, is_connected: false } : user);
  } else if (type === 'user_reconnected') {
    room.users = room.users.map((user) => user.user_id === payload.user_id ? { ...user, is_connected: true } : user);
  } else if (type === 'sync_state') {
    roomSetState(payload);
  } else if (type === 'sync_playback') {
    const action = payload.action;
    room.suppressBroadcast = true;
    if (action === 'change_track' && payload.track_info?.id) {
      const track = { ...payload.track_info, duration: payload.track_info.duration ? durationText(payload.track_info.duration) : '' };
      const index = state.queue.findIndex((item) => item.id === track.id);
      if (index >= 0) state.index = index; else { state.queue.push(track); state.index = state.queue.length - 1; }
      audio.src = `/api/stream/${encodeURIComponent(track.id)}`; audio.currentTime = 0;
      audio.play().catch(() => {}); persistQueue(); syncPlayer();
    } else if (action === 'play') {
      if (Number.isFinite(Number(payload.position))) audio.currentTime = Number(payload.position) / 1000;
      audio.play().catch(() => {});
    } else if (action === 'pause') audio.pause();
    else if (action === 'seek' && Number.isFinite(Number(payload.position))) audio.currentTime = Number(payload.position) / 1000;
    else if (action === 'skip_next') moveQueue(1);
    else if (action === 'skip_prev') moveQueue(-1);
    else if (action === 'set_volume' && payload.volume !== undefined) setVolume(payload.volume);
    else if (action === 'sync_queue' && Array.isArray(payload.queue)) {
      state.queue = payload.queue.map((item) => ({ ...item, duration: item.duration ? durationText(item.duration) : '' })); persistQueue(); syncPlayer();
    } else if (action === 'queue_add' && payload.track_info?.id) {
      state.queue.push({ ...payload.track_info, duration: payload.track_info.duration ? durationText(payload.track_info.duration) : '' }); persistQueue(); syncPlayer();
    } else if (action === 'queue_clear') { state.queue = current() ? [current()] : []; state.index = state.queue.length ? 0 : -1; persistQueue(); syncPlayer(); }
    setTimeout(() => { room.suppressBroadcast = false; }, 250);
  } else if (type === 'chat_message') {
    room.messages.push(payload); room.messages = room.messages.slice(-60);
  } else if (type === 'room_settings_changed') {
    room.allowControl = Boolean(payload.allow_participant_control);
  } else if (type === 'host_changed') {
    const newHostId = payload.new_host_id;
    room.role = newHostId === room.userId ? 'host' : 'guest';
    room.users = room.users.map((user) => ({ ...user, is_host: user.user_id === newHostId }));
  } else if (type === 'error') {
    room.status = 'error'; room.error = payload.message || 'The room server returned an error.';
  } else if (type === 'kicked') {
    room.status = 'error'; room.error = payload.reason || 'You were removed from this room.'; room.code = '';
  }
  if (state.view === 'together') renderView();
}

function connectRoom(mode, username, code = '') {
  const room = state.room;
  username = username.trim().slice(0, 32);
  const server = ($('#room-server')?.value || room.server).trim();
  if (!username) { notify('Add a display name first.'); return; }
  if (!/^wss?:\/\//i.test(server)) { room.error = 'Room server must start with ws:// or wss://.'; renderView(); return; }
  try { room.socket?.close(); } catch {}
  room.username = username; room.server = server; room.status = 'connecting'; room.error = ''; room.role = ''; room.requests = []; room.messages = [];
  store.write('roomUsername', username); store.write('roomServer', server); renderView();
  let socket;
  try { socket = new WebSocket(server); }
  catch (error) { room.status = 'error'; room.error = error.message; renderView(); return; }
  socket.binaryType = 'arraybuffer'; room.socket = socket;
  socket.onopen = () => {
    room.status = mode === 'join' ? 'waiting' : 'connecting'; renderView();
    roomSend(mode === 'join' ? 'join_room' : 'create_room', mode === 'join' ? { room_code: code.trim().toUpperCase(), username } : { username });
  };
  socket.onmessage = async (event) => {
    if (typeof event.data !== 'string') {
      room.status = 'error'; room.error = 'This room server switched to a binary protocol the browser client does not support.'; renderView(); return;
    }
    try { handleRoomMessage(JSON.parse(event.data)); }
    catch (error) { console.warn('Room message:', error); }
  };
  socket.onerror = () => { room.status = 'error'; room.error = 'Could not reach the room server. Check your connection and try again.'; renderView(); };
  socket.onclose = () => {
    if (room.status !== 'disconnected' && room.status !== 'error' && room.code) {
      room.status = 'error'; room.error = 'Connection to the room was lost.'; renderView();
    }
  };
  setTimeout(() => {
    if (room.status === 'connecting' && socket.readyState !== WebSocket.OPEN) {
      room.status = 'error'; room.error = 'The room server did not respond. Try again in a moment.'; renderView();
    }
  }, 12_000);
}

function leaveRoom() {
  const room = state.room;
  roomSend('leave_room');
  try { room.socket?.close(1000, 'Left the room'); } catch {}
  room.socket = null; room.status = 'disconnected'; room.role = ''; room.code = ''; room.userId = ''; room.users = []; room.requests = []; room.messages = []; room.error = '';
  store.write('roomSession', null);
  if (state.view === 'together') renderView();
}

function roomChat(message) {
  message = message.trim().slice(0, 500);
  if (!message) return;
  if (roomSend('chat', { message })) { $('#room-chat-form input').value = ''; }
}

function applyRoomPlayback(action) {
  state.room.suppressBroadcast = true;
  if (action === 'play') audio.play().catch(() => {});
  else if (action === 'pause') audio.pause();
  else if (action === 'change_track') broadcastRoomPlayback('change_track');
  setTimeout(() => { state.room.suppressBroadcast = false; }, 300);
}

function playlistDetailView(playlist) {
  const tracks = playlist.tracks || [];
  return `<div class="entity-page"><button class="back-link" data-view="library">${icon('arrow-left')} Your library</button><section class="entity-hero playlist-entity"><div class="entity-cover">${tracks[0]?.thumbnail ? trackImage(tracks[0]) : icon('disc-3')}</div><div class="entity-meta"><div class="eyebrow">YOUR PLAYLIST</div><h1 class="page-heading">${esc(playlist.name)}</h1><p class="page-subtitle">${tracks.length} songs · by Sugam Deol</p><div class="entity-actions"><button class="primary-button" data-play-group="playlist">${icon('play')} Play playlist</button><button class="secondary-button" data-action="shuffle-playlist">${icon('shuffle')} Shuffle</button><button class="icon-button" data-action="delete-playlist" title="Delete playlist" aria-label="Delete playlist">${icon('ellipsis')}</button></div></div></section>${tracks.length ? `<div class="track-list">${tracks.map((track,index) => trackRow(track,index)).join('')}</div>` : emptyState('This playlist is ready for a first song', 'Use More on any song to add it here.', 'music', '<button class="text-action" data-view="search">Find songs</button>')}</div>`;
}

function remoteDetailView() {
  const detail = state.detail;
  if (!detail) return emptyState('Music details could not load', 'Go back and try opening this result again.', 'music', '<button class="text-action" data-view="search">Back to search</button>');
  const { kind, data } = detail;
  if (detail.loading) return `<button class="back-link" data-action="back-search">${icon('arrow-left')} Back</button><div class="entity-loading"><div class="loading-bars"><i></i><i></i><i></i></div><strong>Opening ${esc(kind)}</strong></div>`;
  const header = data[kind] || {};
  const allSections = data.sections || (data.items ? [{ title: 'Track list', items: data.items }] : []);
  const songs = allSections.find((section) => /top songs|track list|songs/i.test(section.title))?.items || allSections.flatMap((section) => section.items || []).filter((item) => item.type === 'song' || item.type === 'video');
  return `<div class="entity-page"><button class="back-link" data-action="back-search">${icon('arrow-left')} Back to search</button>
    <section class="entity-hero"><div class="entity-cover ${kind === 'artist' ? 'round-cover' : ''}">${header.thumbnail ? trackImage(header) : icon(kind === 'artist' ? 'users' : 'disc-3')}</div><div class="entity-meta"><div class="eyebrow">${kind === 'artist' ? 'ARTIST' : kind === 'album' ? 'ALBUM' : 'YOUTUBE MUSIC PLAYLIST'}</div><h1 class="page-heading">${esc(header.title)}</h1><p class="page-subtitle">${esc(header.subtitle || header.description || '')}</p><div class="entity-actions"><button class="primary-button" data-play-group="detail" ${songs.length ? '' : 'disabled'}>${icon('play')} Play ${kind === 'artist' ? 'top songs' : 'all'}</button>${songs.length > 1 ? `<button class="secondary-button" data-action="shuffle-detail">${icon('shuffle')} Shuffle</button>` : ''}</div></div></section>
    ${allSections.map((section) => `<section class="section"><div class="section-head"><div><div class="section-overline">${kind === 'artist' ? 'MORE FROM THIS ARTIST' : 'IN THIS COLLECTION'}</div><h2 class="section-title">${esc(section.title || 'Songs')}</h2></div></div>${section.items.some((item) => ['artist', 'album', 'playlist'].includes(item.type)) ? `<div class="media-strip">${section.items.map((item) => mediaCard(item, item.type)).join('')}</div>` : `<div class="track-list">${section.items.map((track,index) => trackRow(track,index)).join('')}</div>`}</section>`).join('')}
  </div>`;
}

function renderView() {
  const view = $('#view');
  const pages = { home: homeView, search: searchView, library: libraryView, liked: () => { state.libraryTab = 'Liked'; return libraryView(); }, profile: profileView, appearance: appearanceView, together: togetherView };
  if (state.currentPlaylist) view.innerHTML = playlistDetailView(state.currentPlaylist);
  else if (state.detail) view.innerHTML = remoteDetailView();
  else view.innerHTML = (pages[state.view] || homeView)();
  renderPlaylistNav();
}

function renderPlaylistNav() {
  $('#playlist-nav').innerHTML = state.playlists.map((playlist) => `<button class="playlist-link" data-playlist-id="${esc(playlist.id)}">${icon('music')}<span>${esc(playlist.name)}</span></button>`).join('') || '<span class="playlist-empty">Your playlists will live here.</span>';
}

function addRecentSearch(query) {
  state.recentSearches = [query, ...state.recentSearches.filter((item) => item.toLowerCase() !== query.toLowerCase())].slice(0, 8);
  store.write('searches', state.recentSearches);
}

async function search(query = state.query, type = state.searchType) {
  query = query.trim(); if (!query) { state.query = ''; state.results = []; renderView(); return; }
  state.query = query; state.searchType = type; state.results = []; state.searchError = ''; state.searching = true;
  const requestId = ++state.requestId;
  if (state.view !== 'search') setView('search'); else renderView();
  $('#search-results').innerHTML = searchResultArea();
  setService('Searching', 'busy');
  try {
    if (type === 'local') {
      state.results = state.localSongs.filter((track) => `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(query.toLowerCase()));
      state.searching = false;
      addRecentSearch(query);
      $('#search-results').innerHTML = searchResultArea();
      setService('Ready to play');
      return;
    }
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&type=${encodeURIComponent(type)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Search failed.');
    if (requestId !== state.requestId) return;
    state.results = data.items || data.tracks || [];
    state.searching = false;
    addRecentSearch(query);
    $('#search-results').innerHTML = searchResultArea();
    setService('Ready to play');
  } catch (error) {
    if (requestId !== state.requestId) return;
    state.searching = false; state.searchError = error.message || 'Search is unavailable.';
    $('#search-results').innerHTML = searchResultArea();
    setService('Search unavailable', 'error');
  }
}

async function loadHome() {
  if (state.homeLoading || state.homeSections.length) return;
  state.homeLoading = true; state.homeError = '';
  if (state.view === 'home') renderView();
  try {
    const response = await fetch('/api/home');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Discovery is unavailable.');
    state.homeSections = data.sections || [];
  } catch (error) { state.homeError = error.message; }
  state.homeLoading = false;
  if (state.view === 'home') renderView();
}

async function openRemote(kind, id) {
  if (!id) return;
  state.currentPlaylist = null;
  state.returnView = state.view;
  state.detail = { kind, loading: true };
  state.view = kind; navSelection(kind); renderView();
  try {
    const response = await fetch(`/api/${kind}/${encodeURIComponent(id)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `This ${kind} could not be opened.`);
    state.detail = { kind, id, data, loading: false };
  } catch (error) { state.detail = null; notify(error.message); state.view = 'search'; navSelection('search'); }
  renderView();
}

function addRecent(track) {
  state.recent = [track, ...state.recent.filter((item) => item.id !== track.id)].slice(0, 80);
  store.write('recent', state.recent); renderPlaylistNav();
}
function persistQueue() { store.write('queue', state.queue); store.write('index', state.index); }
function updateLikes() { store.write('liked', state.liked); syncPlayer(); renderView(); }
function toggleLike(track) {
  if (!track) return;
  state.liked = isLiked(track) ? state.liked.filter((item) => item.id !== track.id) : [track, ...state.liked];
  updateLikes();
  notify(isLiked(track) ? 'Added to liked songs.' : 'Removed from liked songs.');
}

function playAt(tracks, index, append = false) {
  if (!tracks?.length || !tracks[index]) return;
  state.queue = append ? [...state.queue.slice(0, state.index + 1), ...tracks.slice(index)] : [...tracks];
  state.index = append ? Math.min(state.index + 1, state.queue.length - 1) : index;
  startCurrent();
}

function startCurrent() {
  const track = current(); if (!track) return;
  const source = track.local ? state.localUrls.get(track.id) : `/api/stream/${encodeURIComponent(track.id)}`;
  if (!source) { notify('This local audio file is missing. Import it again from this browser.'); return; }
  if (audio.src !== new URL(source, location.href).href) audio.src = source;
  state.playing = false; persistQueue(); addRecent(track); syncPlayer(); setService('Loading track', 'busy');
  loadRelated(track).then(() => {
    if (!$('#sheet').classList.contains('hidden') && $('#sheet-heading').textContent === 'Up next' && current()?.id === track.id) renderQueueSheet();
  });
  if (!state.room.suppressBroadcast && state.room.status === 'connected') {
    syncQueueToRoom();
    broadcastRoomPlayback('change_track');
  }
  audio.play().then(() => {
    state.playing = true; setService('Now playing'); syncPlayer(); updateMediaSession();
  }).catch((error) => {
    state.playing = false; setService('Playback unavailable', 'error'); syncPlayer();
    notify(error?.name === 'NotAllowedError' ? 'Tap play to start listening.' : 'This stream did not start. Try another track.');
    console.warn('Playback:', error.message);
  });
}

function moveQueue(delta) {
  if (!state.queue.length) return;
  if (delta < 0 && audio.currentTime > 3) { audio.currentTime = 0; return; }
  let next = state.index + delta;
  if (state.shuffle && delta > 0 && state.queue.length > 1) {
    next = Math.floor(Math.random() * state.queue.length);
    if (next === state.index) next = (next + 1) % state.queue.length;
  } else if (next < 0) next = state.repeat === 'all' ? state.queue.length - 1 : 0;
  else if (next >= state.queue.length) {
    if (state.repeat === 'all') next = 0;
    else if (store.read('autoplay', true)) { continueWithRelated(); return; }
    else { audio.pause(); state.playing = false; syncPlayer(); setService('Queue finished'); return; }
  }
  state.index = next; startCurrent();
}

function setIcon(button, name) {
  if (!button) return;
  const target = $('.icon', button) || button;
  const className = (target.getAttribute('class') || '').split(/\s+/).filter((value) => value && value !== 'icon').join(' ');
  target.outerHTML = icon(name, className);
}

function syncPlayer() {
  const track = current();
  const hasTrack = !!track;
  $('#mini-player').classList.toggle('hidden', !hasTrack);
  $('#now-panel').classList.toggle('has-track', hasTrack);
  if (!hasTrack) return;
  const liked = isLiked(track);
  const art = artworkUrl(track.thumbnail || '/aurora.svg');
  const miniArt = $('#mini-art');
  miniArt.src = art; miniArt.dataset.fallbackSrc = track.thumbnail || '/aurora.svg'; miniArt.setAttribute('data-art-fallback', '');
  $('#mini-title').textContent = track.title; $('#mini-artist').textContent = track.artist;
  $('#panel-art').innerHTML = trackImage(track, 'panel-image');
  $('#full-art').innerHTML = trackImage(track, 'full-image');
  $('#panel-title').textContent = track.title; $('#panel-artist').textContent = track.artist;
  $('#full-title').textContent = track.title; $('#full-artist').textContent = track.artist;
  $('#mini-like').classList.toggle('liked', liked); $('#full-like').classList.toggle('liked', liked); $('#panel-like').classList.toggle('liked', liked);
  $('#mini-like').setAttribute('aria-label', liked ? 'Remove from liked songs' : 'Add to liked songs');
  $('#full-like').lastElementChild.textContent = liked ? 'Liked' : 'Like';
  for (const id of ['play-pause', 'full-play', 'panel-play']) {
    const button = $(`#${id}`); setIcon(button, state.playing ? 'pause' : 'play');
    button.setAttribute('aria-label', state.playing ? 'Pause' : 'Play'); button.title = state.playing ? 'Pause' : 'Play';
  }
  for (const id of ['shuffle', 'panel-shuffle']) $(`#${id}`).classList.toggle('is-active', state.shuffle);
  for (const id of ['repeat', 'panel-repeat']) {
    const button = $(`#${id}`);
    button.classList.toggle('is-active', state.repeat !== 'off');
    button.dataset.repeat = state.repeat;
    button.title = `Repeat ${state.repeat}`; button.setAttribute('aria-label', `Repeat ${state.repeat}`);
    const base = state.repeat === 'one' ? 'repeat' : 'repeat'; setIcon(button, base);
    if (state.repeat === 'one') button.dataset.repeat = 'one';
  }
  const album = $('#full-album');
  album.hidden = !track.album;
  if (track.album) { album.textContent = track.album; album.dataset.id = track.albumId || ''; }
  persistQueue();
}

function syncProgress() {
  const value = audio.duration ? Math.round(audio.currentTime / audio.duration * 1000) : 0;
  const total = Number.isFinite(audio.duration) ? audio.duration : 0;
  const controls = [
    ['#progress', '#mini-elapsed', '#mini-duration'],
    ['#full-progress', '#full-elapsed', '#full-duration'],
    ['#panel-progress', '#panel-elapsed', '#panel-duration'],
  ];
  for (const [slider, elapsed, duration] of controls) {
    $(slider).value = value; $(slider).style.setProperty('--range', `${value / 10}%`);
    $(elapsed).textContent = durationText(audio.currentTime); $(duration).textContent = durationText(total);
  }
  if ('mediaSession' in navigator && Number.isFinite(audio.duration)) {
    navigator.mediaSession.setPositionState?.({ duration: audio.duration, playbackRate: audio.playbackRate || 1, position: audio.currentTime });
  }
}

function setVolume(value) {
  const volume = Math.max(0, Math.min(1, Number(value)));
  audio.volume = volume; store.write('volume', volume);
  for (const id of ['panel-volume', 'full-volume']) $(`#${id}`).value = volume;
  setIcon($('#mute'), volume ? 'volume-x' : 'volume');
  broadcastRoomPlayback('set_volume', { volume });
}

function updateMediaSession() {
  if (!('mediaSession' in navigator) || !current()) return;
  const track = current();
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: track.album || 'Aurora Music', artwork: [{ src: artworkUrl(track.thumbnail || '/aurora.svg'), sizes: '1200x1200', type: 'image/jpeg' }] });
    navigator.mediaSession.setActionHandler('play', () => audio.play());
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => moveQueue(-1));
    navigator.mediaSession.setActionHandler('nexttrack', () => moveQueue(1));
    navigator.mediaSession.setActionHandler('seekto', (details) => { if (details.seekTime) audio.currentTime = details.seekTime; });
  } catch {}
}

async function continueWithRelated() {
  const track = current();
  if (!track || track.local) {
    audio.pause(); state.playing = false; syncPlayer(); setService('Queue finished'); return;
  }
  setService('Finding something similar', 'busy');
  try {
    const suggestions = await loadRelated(track);
    const additions = suggestions.filter((item) => item.id && item.id !== track.id && !state.queue.some((queued) => queued.id === item.id));
    if (!additions.length) throw new Error('No related tracks found.');
    state.queue.push(...additions.slice(0, 12));
    state.index += 1; persistQueue(); startCurrent();
  } catch (error) {
    audio.pause(); state.playing = false; syncPlayer(); setService('Queue finished');
    notify(error.message || 'The queue has ended.');
  }
}

async function loadRelated(track = current(), retry = false) {
  if (!track || track.local) return [];
  if (!retry && state.relatedLoadedFor === track.id) return state.relatedTracks;
  if (!retry && state.relatedLoadingFor === track.id && state.relatedPromise) return state.relatedPromise;
  state.relatedLoadedFor = track.id; state.relatedLoadingFor = track.id; state.relatedTracks = []; state.relatedError = '';
  const requestedId = track.id;
  const request = (async () => {
    try {
      const response = await fetch(`/api/related/${encodeURIComponent(requestedId)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Suggestions could not load.');
      const sections = data.sections || [];
      const best = sections.find((section) => /you might also like|more like this|related|radio/i.test(section.title)) || sections.find((section) => section.items?.length) || sections[0];
      const ordered = [...(best ? [best] : []), ...sections.filter((section) => section !== best)];
      const seen = new Set([requestedId]);
      const suggestions = ordered.flatMap((section) => section.items || []).filter((item) => {
        if (!item.id || seen.has(item.id) || ['artist', 'album', 'playlist'].includes(String(item.type).toLowerCase())) return false;
        seen.add(item.id); return true;
      }).slice(0, 16);
      if (state.relatedLoadedFor === requestedId) state.relatedTracks = suggestions;
      if (!suggestions.length && state.relatedLoadedFor === requestedId) state.relatedError = 'No song suggestions were returned for this track.';
    } catch (error) {
      if (state.relatedLoadedFor === requestedId) state.relatedError = error.message || 'Suggestions could not load.';
    } finally {
      if (state.relatedLoadingFor === requestedId) { state.relatedLoadingFor = ''; state.relatedPromise = null; }
    }
    return state.relatedLoadedFor === requestedId ? state.relatedTracks : [];
  })();
  state.relatedPromise = request;
  return request;
}

function renderQueueSheet() {
  const body = $('#sheet-body');
  const track = current();
  const queue = state.queue.length ? `<div class="queue-subtitle">${state.queue.length} songs · ${track?.title ? `Playing ${esc(track.title)}` : 'Ready when you are'}</div><div class="queue-list">${state.queue.map((item,index) => `<div class="queue-row ${index === state.index ? 'queue-current' : ''}">${trackImage(item, 'queue-art')}<button class="queue-track" data-queue-index="${index}"><strong>${esc(item.title)}</strong><small>${esc(item.artist)}</small></button><div class="queue-row-actions"><button class="icon-button tiny" data-queue-move="${index}" data-delta="-1" aria-label="Move up" ${index === 0 ? 'disabled' : ''}>↑</button><button class="icon-button tiny" data-queue-move="${index}" data-delta="1" aria-label="Move down" ${index === state.queue.length-1 ? 'disabled' : ''}>↓</button><button class="icon-button tiny" data-remove-queue="${index}" aria-label="Remove from queue">${icon('x')}</button></div></div>`).join('')}</div><button class="text-action clear-queue" data-action="clear-queue">Clear queue</button>` : `<div class="empty-inline">Your queue is empty. Add a song to start listening.</div>`;
  let recommendations = '';
  if (!track) recommendations = `<div class="empty-inline">Start a song to get recommendations.</div>`;
  else if (track.local) recommendations = `<div class="empty-inline">Recommendations appear for streamed songs.</div>`;
  else if (state.relatedLoadingFor === track.id) recommendations = `<div class="suggestions-loading"><span class="loading-bars"><i></i><i></i><i></i></span>Finding your next songs…</div>`;
  else {
    const suggestions = state.relatedTracks.filter((item) => item.id !== track.id).slice(0, 8);
    recommendations = suggestions.length ? `<div class="suggestion-list">${suggestions.map((item) => `<div class="suggestion-row">${trackImage(item, 'suggestion-art')}<div class="suggestion-meta"><strong>${esc(item.title)}</strong><small>${esc(item.artist)}</small></div><button class="secondary-button suggestion-next" data-related-play="${esc(item.id)}">${state.queue.some((queued) => queued.id === item.id) ? 'Move to next' : 'Play next'}</button></div>`).join('')}</div>`
      : state.relatedError ? `<div class="suggestions-empty"><span>${esc(state.relatedError)}</span><button class="text-action" data-action="retry-related">Try again</button></div>`
      : `<div class="empty-inline">No more songs to suggest right now.</div>`;
  }
  body.innerHTML = `<section class="queue-suggestions"><div class="sheet-subheading">NEXT FOR YOU</div><p>Picked from the song you’re playing.</p>${recommendations}</section><section class="queue-contents"><div class="sheet-subheading">YOUR QUEUE</div>${queue}</section>`;
}

async function openSheet(kind = 'queue') {
  const sheet = $('#sheet'); sheet.classList.remove('hidden');
  const heading = kind === 'lyrics' ? 'Lyrics' : kind === 'actions' ? 'Song options' : kind === 'playlist-actions' ? 'Playlist options' : 'Up next';
  $('#sheet-heading').textContent = heading;
  const body = $('#sheet-body');
  if (kind === 'lyrics') {
    body.innerHTML = `<div class="lyrics-loading"><div class="loading-bars"><i></i><i></i><i></i></div><span>Looking for lyrics</span></div>`;
    const track = current();
    if (!track) { body.innerHTML = emptyState('No song is playing', 'Start a song to look up its lyrics.', 'align-left'); return; }
    try {
      const response = await fetch(`/api/lyrics/${encodeURIComponent(track.id)}`); const data = await response.json();
      if (current()?.id !== track.id) return;
      body.innerHTML = data.lyrics ? `<div class="lyrics-content"><div class="lyrics-title">${esc(track.title)}</div><div class="lyrics-artist">${esc(track.artist)}</div><pre class="lyric-text">${esc(data.lyrics)}</pre></div>` : emptyState('Lyrics aren’t available', 'Try opening the song in YouTube Music.', 'align-left');
    } catch { body.innerHTML = emptyState('Lyrics couldn’t load', 'Check your connection and try again.', 'align-left'); }
    return;
  }
  if (kind === 'actions') {
    const track = state.pendingTrack || current();
    if (!track) { body.innerHTML = emptyState('Choose a song first', 'Search for a song and open its options.', 'music'); return; }
    body.innerHTML = `<div class="action-track">${trackImage(track, 'action-art')}<div><strong>${esc(track.title)}</strong><span>${esc(track.artist)}</span></div></div><div class="sheet-action-list"><button class="sheet-action" data-action="play-now">${icon('play')}<span>Play now</span></button><button class="sheet-action" data-action="play-next">${icon('list-music')}<span>Play next</span></button><button class="sheet-action" data-action="add-queue">${icon('plus')}<span>Add to queue</span></button><button class="sheet-action" data-action="share-track">${icon('external-link')}<span>Share song</span></button></div><div class="sheet-subheading">ADD TO PLAYLIST</div>${state.playlists.length ? state.playlists.map((playlist) => `<button class="sheet-action" data-add-playlist="${esc(playlist.id)}">${icon('disc-3')}<span>${esc(playlist.name)}</span>${playlist.tracks.some((item) => item.id === track.id) ? icon('check-circle') : ''}</button>`).join('') : `<div class="empty-inline">No playlists yet. Create one to save this song.</div>`}<button class="text-action sheet-create-playlist" id="sheet-new-playlist">${icon('plus')} Create a playlist</button>`;
    return;
  }
  if (kind === 'playlist-actions') {
    body.innerHTML = `<button class="sheet-action" data-action="rename-playlist">${icon('music')}<span>Rename playlist</span></button><button class="sheet-action danger-action" data-action="delete-playlist">${icon('x')}<span>Delete playlist</span></button>`;
    return;
  }
  renderQueueSheet();
  const track = current();
  if (track && !track.local) loadRelated(track).then(() => {
    if (!sheet.classList.contains('hidden') && $('#sheet-heading').textContent === 'Up next' && current()?.id === track.id) renderQueueSheet();
  });
}

function openCreatePlaylist() {
  const dialog = $('#playlist-dialog');
  if (dialog?.showModal) { dialog.showModal(); $('#playlist-name')?.focus(); }
  else createPlaylist(window.prompt('Name your playlist'));
}
function createPlaylist(name) {
  if (!name?.trim()) return;
  const playlist = { id: crypto.randomUUID(), name: name.trim().slice(0, 48), tracks: [] };
  state.playlists = [playlist, ...state.playlists]; store.write('playlists', state.playlists);
  state.currentPlaylist = playlist; state.view = 'library'; state.libraryTab = 'Playlists'; renderView(); notify('Playlist created.');
}
function openPlaylist(id) {
  const playlist = state.playlists.find((item) => item.id === id); if (!playlist) return;
  state.currentPlaylist = playlist; state.detail = null; state.view = 'library'; navSelection('library'); renderView();
}
function addToPlaylist(id, track) {
  const playlist = state.playlists.find((item) => item.id === id);
  if (!playlist || !track) return;
  if (!playlist.tracks.some((item) => item.id === track.id)) playlist.tracks.push(track);
  store.write('playlists', state.playlists); renderView(); notify(`Added to ${playlist.name}.`); $('#sheet').classList.add('hidden');
}
function playGroup(tracks, shuffle = false) {
  const valid = tracks.filter((item) => item?.id);
  if (!valid.length) return;
  const list = shuffle ? [...valid].sort(() => Math.random() - 0.5) : valid;
  playAt(list, 0);
}

function entitySongs() {
  const sections = state.detail?.data?.sections || [];
  return sections.find((section) => /top songs|track list|songs/i.test(section.title))?.items || sections.flatMap((section) => section.items || []).filter((item) => item.type === 'song' || item.type === 'video');
}

function handleClick(event) {
  const control = event.target.closest('button, a[data-view], label[data-action], [data-play], [data-open-kind], [data-playlist-id], [data-search-type], [data-query], .mini-current');
  if (!control) return;
  if (control.id === 'apply-style') { setStyle($('input[name="style"]:checked')?.value || 'glass'); return; }
  if (control.dataset.roomApprove) { roomSend('approve_join', { user_id: control.dataset.roomApprove }); room.requests = room.requests.filter((item) => item.user_id !== control.dataset.roomApprove); renderView(); return; }
  if (control.dataset.roomReject) { roomSend('reject_join', { user_id: control.dataset.roomReject, reason: 'The host declined the request.' }); room.requests = room.requests.filter((item) => item.user_id !== control.dataset.roomReject); renderView(); return; }
  if (control.dataset.view) { setView(control.dataset.view); return; }
  if (control.id === 'top-search') { setView('search'); return; }
  if (control.id === 'appearance-open') { setView('appearance'); return; }
  if (control.id === 'new-playlist' || control.id === 'new-playlist-inline' || control.id === 'sheet-new-playlist') { openCreatePlaylist(); return; }
  if (control.dataset.libraryTab) { state.currentPlaylist = null; state.libraryTab = control.dataset.libraryTab; state.view = 'library'; navSelection('library'); renderView(); return; }
  if (control.dataset.searchType) { state.searchType = control.dataset.searchType; if (state.query) search(state.query, state.searchType); else renderView(); return; }
  if (control.dataset.query) { state.searchType = 'song'; search(control.dataset.query, 'song'); return; }
  if (control.dataset.style) { setStyle(control.dataset.style); return; }
  if (control.dataset.playlistId) { openPlaylist(control.dataset.playlistId); return; }
  if (control.dataset.openKind) { openRemote(control.dataset.openKind, control.dataset.id); return; }
  if (control.dataset.play) {
    const track = findTrack(control.dataset.play);
    if (state.view === 'home' && track) playAt(state.recent, state.recent.findIndex((item) => item.id === track.id));
    else if (track && track.local) playAt(state.localSongs, state.localSongs.findIndex((item) => item.id === track.id));
    else if (state.currentPlaylist) playAt(state.currentPlaylist.tracks, state.currentPlaylist.tracks.findIndex((item) => item.id === track?.id));
    else if (state.detail) playAt(entitySongs(), entitySongs().findIndex((item) => item.id === track?.id));
    else if (track && state.view === 'liked') playAt(state.liked, state.liked.findIndex((item) => item.id === track.id));
    else if (track && state.view === 'library' && state.libraryTab === 'Recent') playAt(state.recent, state.recent.findIndex((item) => item.id === track.id));
    else if (track && state.view === 'library' && state.libraryTab === 'Liked') playAt(state.liked, state.liked.findIndex((item) => item.id === track.id));
    else if (track && state.view === 'search' && !state.results.some((item) => item.id === track.id)) playAt(state.recent, state.recent.findIndex((item) => item.id === track.id));
    else if (track) playAt(state.results, state.results.findIndex((item) => item.id === track.id));
    return;
  }
  if (control.dataset.like) {
    const track = findTrack(control.dataset.like);
    toggleLike(track); return;
  }
  if (control.dataset.relatedPlay) {
    const track = state.relatedTracks.find((item) => item.id === control.dataset.relatedPlay);
    if (!track) return;
    const existing = state.queue.findIndex((item) => item.id === track.id);
    let moved = false;
    if (existing >= 0) {
      const [queued] = state.queue.splice(existing, 1);
      if (existing < state.index) state.index -= 1;
      const insertAt = Math.max(0, state.index + 1);
      state.queue.splice(insertAt, 0, queued); moved = true;
    } else {
      const insertAt = Math.max(0, state.index + 1);
      state.queue.splice(insertAt, 0, track);
    }
    persistQueue(); syncPlayer();
    if (moved) syncQueueToRoom();
    else broadcastRoomPlayback('queue_add', { track_info: roomTrackInfo(track), insert_next: true });
    notify(moved ? 'Moved to play next.' : 'Added to play next.');
    renderQueueSheet(); return;
  }
  if (control.dataset.more) { state.pendingTrack = findTrack(control.dataset.more); openSheet('actions'); return; }
  if (control.dataset.playIndex !== undefined) {
    const tracks = state.detail ? entitySongs() : state.currentPlaylist ? state.currentPlaylist.tracks : state.view === 'search' ? (state.results.length ? state.results : state.recent) : state.view === 'liked' || state.libraryTab === 'Liked' ? state.liked : state.libraryTab === 'Local' ? state.localSongs : state.recent;
    playAt(tracks, Number(control.dataset.playIndex)); return;
  }
  if (control.dataset.playGroup) {
    const tracks = control.dataset.playGroup === 'playlist' ? state.currentPlaylist?.tracks || [] : entitySongs();
    playGroup(tracks, control.dataset.playGroup === 'shuffle' || control.hasAttribute('data-shuffle')); return;
  }
  if (control.dataset.openSheet) { openSheet(control.dataset.openSheet); return; }
  if (control.dataset.queueIndex !== undefined) { state.index = Number(control.dataset.queueIndex); startCurrent(); return; }
  if (control.dataset.addPlaylist) { addToPlaylist(control.dataset.addPlaylist, state.pendingTrack || current()); return; }
  if (control.dataset.removeQueue !== undefined) {
    const index = Number(control.dataset.removeQueue); const [removed] = state.queue.splice(index, 1);
    if (index < state.index) state.index -= 1; else if (index === state.index) { state.index = Math.min(index, state.queue.length - 1); if (current()) startCurrent(); else { audio.pause(); state.playing = false; } }
    persistQueue(); syncPlayer(); if (removed) broadcastRoomPlayback('queue_remove', { track_id: removed.id }); openSheet('queue'); return;
  }
  if (control.dataset.queueMove !== undefined) {
    const index = Number(control.dataset.queueMove); const target = index + Number(control.dataset.delta);
    if (target >= 0 && target < state.queue.length) {
      [state.queue[index], state.queue[target]] = [state.queue[target], state.queue[index]];
      if (index === state.index) state.index = target; else if (target === state.index) state.index = index;
      persistQueue(); syncQueueToRoom(); openSheet('queue');
    }
    return;
  }
  if (control.dataset.action) { handleAction(control.dataset.action); return; }
  if (control.id === 'mini-expand') { openFullPlayer(); return; }
  if (control.id === 'play-pause' || control.id === 'full-play' || control.id === 'panel-play') { if (!current()) return; audio.paused ? audio.play().catch(() => {}) : audio.pause(); return; }
  if (control.id === 'next' || control.id === 'full-next' || control.id === 'panel-next') { moveQueue(1); return; }
  if (control.id === 'previous' || control.id === 'full-previous' || control.id === 'panel-previous') { moveQueue(-1); return; }
  if (control.id === 'mini-like' || control.id === 'full-like' || control.id === 'panel-like') { toggleLike(current()); return; }
  if (control.id === 'shuffle' || control.id === 'panel-shuffle') { state.shuffle = !state.shuffle; store.write('shuffle', state.shuffle); syncPlayer(); return; }
  if (control.id === 'repeat' || control.id === 'panel-repeat') { state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off'; store.write('repeat', state.repeat); syncPlayer(); return; }
  if (control.id === 'open-queue') { openSheet('queue'); return; }
  if (control.id === 'lyrics-open') { openSheet('lyrics'); return; }
  if (control.id === 'close-player' || control.id === 'player-backdrop') { closeFullPlayer(); return; }
  if (control.id === 'sheet-close' || control.classList.contains('sheet-backdrop')) { $('#sheet').classList.add('hidden'); return; }
  if (control.id === 'mute') { const previous = Number(store.read('volume', 0.82)); setVolume(audio.volume ? 0 : previous || 0.82); return; }
  if (control.id === 'full-album' && control.dataset.id) { openRemote('album', control.dataset.id); closeFullPlayer(); return; }
}

function handleAction(action) {
  if (action === 'back-search') { state.detail = null; state.currentPlaylist = null; state.view = 'search'; navSelection('search'); renderView(); return; }
  if (action === 'clear-search') { state.query = ''; state.results = []; state.searchError = ''; renderView(); $('#query')?.focus(); return; }
  if (action === 'clear-search-history') { state.recentSearches = []; store.write('searches', []); renderView(); return; }
  if (action === 'retry-search') { search(state.query, state.searchType); return; }
  if (action === 'retry-home') { state.homeSections = []; loadHome(); return; }
  if (action === 'retry-related') { state.relatedLoadedFor = ''; state.relatedError = ''; openSheet('queue'); return; }
  if (action === 'play-results') { playGroup(state.results); return; }
  if (action === 'play-now') { playAt([state.pendingTrack || current()], 0); $('#sheet').classList.add('hidden'); return; }
  if (action === 'play-next' || action === 'add-queue') {
    const track = state.pendingTrack || current(); if (!track) return;
    if (!current()) { playAt([track], 0); }
    else { const insertAt = action === 'play-next' ? state.index + 1 : state.queue.length; state.queue.splice(insertAt, 0, track); persistQueue(); broadcastRoomPlayback('queue_add', { track_info: roomTrackInfo(track), insert_next: action === 'play-next' }); notify(action === 'play-next' ? 'Playing next.' : 'Added to queue.'); }
    $('#sheet').classList.add('hidden'); return;
  }
  if (action === 'share-track') {
    const track = state.pendingTrack || current(); if (!track) return;
    const url = `https://music.youtube.com/watch?v=${encodeURIComponent(track.id)}`;
    if (navigator.share) navigator.share({ title: track.title, text: track.artist, url }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(() => notify('Song link copied.')).catch(() => notify(url));
    return;
  }
  if (action === 'clear-queue') { state.queue = current() ? [current()] : []; state.index = state.queue.length ? 0 : -1; persistQueue(); syncPlayer(); broadcastRoomPlayback('queue_clear'); openSheet('queue'); return; }
  if (action === 'shuffle-playlist') { playGroup(state.currentPlaylist?.tracks || [], true); return; }
  if (action === 'shuffle-detail') { playGroup(entitySongs(), true); return; }
  if (action === 'delete-playlist') { deleteCurrentPlaylist(); return; }
  if (action === 'rename-playlist') { renameCurrentPlaylist(); return; }
  if (action === 'export-library') { exportLibrary(); return; }
  if (action === 'copy-room-code') { navigator.clipboard?.writeText(state.room.code).then(() => notify('Room code copied.')).catch(() => notify(state.room.code)); return; }
  if (action === 'leave-room') { leaveRoom(); return; }
  if (action === 'dismiss-room-error') { state.room.error = ''; state.room.status = 'disconnected'; renderView(); return; }
}

function deleteCurrentPlaylist() {
  if (!state.currentPlaylist) return;
  const playlist = state.currentPlaylist;
  if (!confirm(`Delete “${playlist.name}”?`)) return;
  state.playlists = state.playlists.filter((item) => item.id !== playlist.id);
  store.write('playlists', state.playlists); state.currentPlaylist = null; state.libraryTab = 'Playlists'; state.view = 'library'; $('#sheet').classList.add('hidden'); renderView(); notify('Playlist deleted.');
}
function renameCurrentPlaylist() {
  if (!state.currentPlaylist) return;
  const playlist = state.currentPlaylist; const name = prompt('Rename playlist', playlist.name);
  if (!name?.trim()) return;
  playlist.name = name.trim().slice(0, 48); store.write('playlists', state.playlists); renderView(); openSheet('playlist-actions');
}
function exportLibrary() {
  const backup = { version: 1, app: 'Aurora Music', exportedAt: new Date().toISOString(), playlists: state.playlists, liked: state.liked, recent: state.recent, searches: state.recentSearches };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `aurora-library-${new Date().toISOString().slice(0,10)}.json`; link.click(); URL.revokeObjectURL(url); notify('Library backup saved.');
}
async function importLibrary(file) {
  try {
    const backup = JSON.parse(await file.text());
    if (backup.app !== 'Aurora Music' || backup.version !== 1) throw new Error('This is not an Aurora Music library backup.');
    state.playlists = Array.isArray(backup.playlists) ? backup.playlists : [];
    state.liked = Array.isArray(backup.liked) ? backup.liked : [];
    state.recent = Array.isArray(backup.recent) ? backup.recent : [];
    state.recentSearches = Array.isArray(backup.searches) ? backup.searches : [];
    for (const [key,value] of Object.entries({ playlists: state.playlists, liked: state.liked, recent: state.recent, searches: state.recentSearches })) store.write(key,value);
    setView('profile'); notify('Library restored.');
  } catch (error) { notify(error.message || 'Could not read that backup.'); }
}

function setStyle(style) {
  const material = style === 'material';
  document.body.classList.toggle('material-style', material);
  store.write('style', style); store.write('styleChosen', true);
  $$('.appearance-option').forEach((option) => option.classList.toggle('selected', option.dataset.style === style));
  $$('.style-option').forEach((option) => option.classList.toggle('selected', option.querySelector('input')?.value === style));
  if (!$('#style-choice').classList.contains('hidden')) $('#style-choice').classList.add('hidden');
  if (state.view === 'profile' || state.view === 'appearance') renderView();
  notify(material ? 'Material UI selected.' : 'Liquid Glass selected.');
}

function openFullPlayer() { $('#full-player').classList.remove('hidden'); document.body.classList.add('player-open'); syncPlayer(); }
function closeFullPlayer() { $('#full-player').classList.add('hidden'); document.body.classList.remove('player-open'); }

async function importAudioFiles(files) {
  const db = await audioDatabase;
  if (!db) { notify('This browser can’t store local audio. Try another browser.'); return; }
  let imported = 0;
  for (const file of files) {
    if (!file.type.startsWith('audio/')) continue;
    const id = `local-${crypto.randomUUID()}`;
    const track = { id, title: file.name.replace(/\.[^.]+$/, ''), artist: file.artist || 'Local music', album: '', duration: '', thumbnail: '', local: true, fileName: file.name, mime: file.type };
    await dbRequest('readwrite', (store) => store.put({ id, file, track }));
    const url = URL.createObjectURL(file); state.localUrls.set(id, url); state.localSongs.push(track); imported += 1;
  }
  if (imported) { state.libraryTab = 'Local'; setView('library'); notify(`${imported} ${imported === 1 ? 'track' : 'tracks'} added to local music.`); }
}

async function hydrateLocalAudio() {
  const rows = await dbRequest('readonly', (store) => store.getAll());
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    if (!row?.file || !row.track) continue;
    const url = URL.createObjectURL(row.file); state.localUrls.set(row.id, url); state.localSongs.push(row.track);
  }
  if (state.localSongs.length && state.view === 'library' && state.libraryTab === 'Local') renderView();
  if (current()?.local && state.localUrls.has(current().id)) audio.src = state.localUrls.get(current().id);
}

function syncAudioState(event) {
  if (event.type === 'timeupdate' || event.type === 'loadedmetadata') syncProgress();
  if (event.type === 'play') { state.playing = true; setService('Now playing'); syncPlayer(); updateMediaSession(); if (!state.room.suppressBroadcast) broadcastRoomPlayback('play'); }
  if (event.type === 'pause') { state.playing = false; syncPlayer(); if (!state.room.suppressBroadcast) broadcastRoomPlayback('pause'); }
  if (event.type === 'ended') {
    if (state.repeat === 'one') { audio.currentTime = 0; audio.play(); }
    else if (state.index < state.queue.length - 1 || state.repeat === 'all' || store.read('autoplay', true)) moveQueue(1);
    else { state.playing = false; syncPlayer(); setService('Queue finished'); }
  }
  if (event.type === 'error' && current()) { state.playing = false; syncPlayer(); setService('Stream unavailable', 'error'); notify('The stream ended unexpectedly. Try another track.'); }
}

document.addEventListener('click', handleClick);
document.addEventListener('submit', (event) => {
  if (event.target.id === 'search-form') { event.preventDefault(); search($('#query').value, state.searchType); }
  if (event.target.id === 'playlist-create-form') { event.preventDefault(); createPlaylist($('#playlist-name').value); $('#playlist-dialog').close(); }
  if (event.target.id === 'room-create-form') { event.preventDefault(); connectRoom('create', $('#room-username').value); }
  if (event.target.id === 'room-join-form') { event.preventDefault(); connectRoom('join', $('#room-join-username').value, $('#room-code-input').value); }
  if (event.target.id === 'room-chat-form') { event.preventDefault(); roomChat(event.target.elements.message.value); }
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'query') $('.clear-search')?.classList.toggle('hidden', !event.target.value);
  if (event.target.id === 'panel-volume' || event.target.id === 'full-volume') setVolume(event.target.value);
});
document.addEventListener('change', async (event) => {
  if (event.target.name === 'style') $$('.style-option').forEach((option) => option.classList.toggle('selected', option.contains(event.target)));
  if (event.target.id === 'local-files') await importAudioFiles([...event.target.files]);
  if (event.target.id === 'backup-file' && event.target.files[0]) await importLibrary(event.target.files[0]);
  if (event.target.id === 'autoplay-setting') store.write('autoplay', event.target.checked);
  if (event.target.id === 'room-participant-control') {
    state.room.allowControl = event.target.checked;
    roomSend('update_room_settings', { allow_participant_control: event.target.checked });
  }
});

for (const id of ['#progress', '#full-progress', '#panel-progress']) $(id).addEventListener('input', (event) => {
  if (audio.duration) { audio.currentTime = Number(event.target.value) / 1000 * audio.duration; broadcastRoomPlayback('seek'); }
});
for (const eventName of ['timeupdate', 'loadedmetadata', 'play', 'pause', 'ended', 'error']) audio.addEventListener(eventName, (event) => syncAudioState(event));
for (const id of ['#sheet-close']) $(id).addEventListener('click', () => $('#sheet').classList.add('hidden'));
for (const id of ['#panel-volume', '#full-volume']) $(id).value = store.read('volume', 0.82);
$('#mute').addEventListener('click', () => setVolume(audio.volume ? 0 : store.read('volume', 0.82)));
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setView('search'); }
  if (event.key === 'Escape') { closeFullPlayer(); $('#sheet').classList.add('hidden'); $('#playlist-dialog')?.close(); }
  if (event.key === ' ' && !['INPUT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement?.tagName) && current()) { event.preventDefault(); audio.paused ? audio.play() : audio.pause(); }
  if (event.key === 'ArrowRight' && event.altKey) moveQueue(1);
  if (event.key === 'ArrowLeft' && event.altKey) moveQueue(-1);
});

window.addEventListener('beforeunload', () => {
  if (state.room.status === 'connected' || state.room.status === 'waiting') roomSend('leave_room');
});

installStaticIcons();
const selectedStyle = store.read('style', 'glass');
document.body.classList.toggle('material-style', selectedStyle === 'material');
for (const [view, entry] of Object.entries({ home: 'home', search: 'search', library: 'library', liked: 'liked' })) { /* anchors remain native controls */ }
setView('home');
setVolume(store.read('volume', 0.82));
if (!store.read('styleChosen', false)) $('#style-choice').classList.remove('hidden');
if (state.queue.length && state.index >= 0 && state.index < state.queue.length) { syncPlayer(); hydrateLocalAudio(); }
loadHome();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

window.aurora = { search, state, playAt, openSheet, setView };
