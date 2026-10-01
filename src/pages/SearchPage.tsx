import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type { MediaEntity, MediaKind, MediaTrack } from '../domain/media';
import { api } from '../lib/api';
import { getSetting, setSetting } from '../lib/db';
import { useLibraryStore } from '../store/library';
import { usePlaybackStore } from '../store/playback';
import { MediaCard, SongRow } from '../components/Media';
import { EmptyState, ErrorState, PageHeader, Pill, Skeleton } from '../components/primitives';
import { Icon } from '../components/Icon';

const kinds: Array<[MediaKind, string]> = [['song', 'Songs'], ['artist', 'Artists'], ['album', 'Albums'], ['playlist', 'Playlists'], ['video', 'Videos'], ['local', 'On this device']];
const browseCategories = [
  { title: 'Pop', search: 'pop hits', tone: 'pop' },
  { title: 'Hip-Hop', search: 'hip hop hits', tone: 'hiphop' },
  { title: 'Punjabi', search: 'Punjabi hits', tone: 'punjabi' },
  { title: 'Bollywood', search: 'Bollywood hits', tone: 'bollywood' },
  { title: 'Dance', search: 'dance hits', tone: 'dance' },
  { title: 'R&B', search: 'R&B hits', tone: 'rnb' },
  { title: 'Indie', search: 'indie music', tone: 'indie' },
  { title: 'Chill', search: 'chill music', tone: 'chill' },
  { title: 'Focus', search: 'instrumental focus music', tone: 'focus' },
  { title: 'Workout', search: 'workout hits', tone: 'workout' },
  { title: 'Soundtracks', search: 'film soundtrack songs', tone: 'soundtracks' },
  { title: '’90s & ’00s', search: '90s 2000s hits', tone: 'decades' },
];

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [input, setInput] = useState(params.get('q') ?? '');
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [suggestionQuery, setSuggestionQuery] = useState('');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  // -1 = focus sits in the input; an index marks the active suggestion
  // (aria-activedescendant pattern: focus never leaves the combobox).
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const requestedKind = params.get('type') as MediaKind | null;
  const [kind, setKind] = useState<MediaKind>(requestedKind && kinds.some(([value]) => value === requestedKind) ? requestedKind : 'song');
  const [scope, setScope] = useState<'catalog' | 'library'>('catalog');
  const [history, setHistory] = useState<string[]>([]);
  const parameterKey = params.toString();
  const localTracks = useLibraryStore((state) => state.localTracks);
  const recent = useLibraryStore((state) => state.recent);
  const likedTracks = useLibraryStore((state) => state.likedTracks);
  const playlists = useLibraryStore((state) => state.playlists);

  useEffect(() => {
    const nextQuery = params.get('q') ?? '';
    const requestedKind = params.get('type') as MediaKind | null;
    const nextKind = requestedKind && kinds.some(([value]) => value === requestedKind) ? requestedKind : 'song';
    if (nextQuery !== query) { setInput(nextQuery); setQuery(nextQuery); }
    if (nextKind !== kind) setKind(nextKind);
  }, [parameterKey]);
  useEffect(() => { void getSetting<string[]>('searches', []).then(setHistory); }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setSuggestionQuery(input.trim()), 180);
    return () => window.clearTimeout(timer);
  }, [input]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const trimmed = input.trim();
      setQuery(trimmed);
      const next = new URLSearchParams(params);
      trimmed ? next.set('q', trimmed) : next.delete('q');
      kind !== 'song' ? next.set('type', kind) : next.delete('type');
      setParams(next, { replace: true });
    }, 320);
    return () => window.clearTimeout(timer);
  }, [input, kind]);

  const remote = useQuery({
    queryKey: ['search', query, kind],
    queryFn: ({ signal }) => api.search(query, kind as Exclude<MediaKind, 'local'>, signal),
    enabled: Boolean(query) && scope === 'catalog' && kind !== 'local',
    staleTime: 45_000,
    retry: 1,
  });
  const suggestionResults = useQuery({
    queryKey: ['suggestions', suggestionQuery],
    queryFn: ({ signal }) => api.suggestions(suggestionQuery, signal),
    enabled: suggestionQuery.length >= 2 && suggestionQuery !== query && scope === 'catalog' && kind === 'song',
    staleTime: 60_000,
    retry: false,
  });
  useEffect(() => {
    if (!query || !remote.data?.length) return;
    const next = [query, ...history.filter((item) => item.toLowerCase() !== query.toLowerCase())].slice(0, 8);
    setHistory(next);
    void setSetting('searches', next);
  }, [remote.dataUpdatedAt]);

  const results = useMemo<Array<MediaEntity | MediaTrack>>(() => {
    if (!query) return [];
    if (scope === 'library') {
      const needle = query.toLocaleLowerCase();
      const unique = new Map<string, MediaTrack>();
      for (const track of [...recent, ...likedTracks, ...localTracks, ...playlists.flatMap((playlist) => playlist.tracks)]) {
        if (kind === 'local' && track.source !== 'local') continue;
        if (`${track.title} ${track.artist} ${track.album ?? ''}`.toLocaleLowerCase().includes(needle)) unique.set(track.id, track);
      }
      return [...unique.values()];
    }
    return kind === 'local'
      ? localTracks.filter((track) => `${track.title} ${track.artist} ${track.album ?? ''}`.toLowerCase().includes(query.toLowerCase()))
      : remote.data ?? [];
  }, [kind, localTracks, likedTracks, playlists, query, recent, remote.data, scope]);
  const tracks = results.filter((item): item is MediaTrack => 'source' in item);
  useEffect(() => {
    if (scope !== 'catalog' || kind !== 'song' || !remote.data?.length) return;
    const first = remote.data.find((item): item is MediaTrack => 'source' in item);
    if (!first) return;
    const timer = window.setTimeout(() => {
      void api.warmStream(first, useLibraryStore.getState().playbackSettings.preferredQuality).catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [remote.data, scope, kind]);
  const submit = (event: React.FormEvent) => { event.preventDefault(); setQuery(input.trim()); };
  const chooseCategory = (search: string) => { setScope('catalog'); setKind('song'); setInput(search); };

  return <div className="page search-page">
    <PageHeader title="Search" description="Find a song, follow a mood, or return to something you love." />
    <div className="search-wrap">
      <form className="search-field glass-surface" onSubmit={(event) => { setSuggestionsOpen(false); submit(event); }}>
        <Icon name="search" />
        <input data-search-input name="q" type="search" role="combobox" value={input} onFocus={() => setSuggestionsOpen(true)} onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 130)} onKeyDown={(event) => {
          const options = suggestionResults.data ?? [];
          if (event.key === 'Escape') { setSuggestionsOpen(false); setActiveSuggestion(-1); return; }
          if (!suggestionsOpen || !options.length) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveSuggestion((current) => {
              const nextIndex = event.key === 'ArrowDown' ? current + 1 : current - 1;
              if (nextIndex < 0) return -1;
              if (nextIndex >= options.length) return 0;
              return nextIndex;
            });
          } else if (event.key === 'Enter' && activeSuggestion >= 0 && options[activeSuggestion]) {
            event.preventDefault();
            const chosen = options[activeSuggestion];
            setInput(chosen); setQuery(chosen); setSuggestionsOpen(false);
            setActiveSuggestion(-1);
          } else if (event.key === 'Tab') {
            setSuggestionsOpen(false);
            setActiveSuggestion(-1);
          }
        }} onChange={(event) => { setInput(event.target.value); setSuggestionsOpen(true); setActiveSuggestion(-1); }} placeholder="Search songs, artists, albums" autoComplete="off" aria-label="Search music" aria-autocomplete="list" aria-expanded={suggestionsOpen && Boolean(suggestionResults.data?.length)} aria-haspopup="listbox" aria-controls="search-suggestions" aria-activedescendant={activeSuggestion >= 0 ? `search-suggestion-${activeSuggestion}` : undefined} />
        {input && <button type="button" onClick={() => setInput('')} aria-label="Clear search"><Icon name="x" size={17} /></button>}
        <button type="submit" className="search-go" aria-label="Run search"><Icon name="chevron-right" /></button>
      </form>
      {suggestionsOpen && Boolean(suggestionResults.data?.length) && <div className="search-suggestions glass-surface" id="search-suggestions" role="listbox" aria-label="Search suggestions">
        {suggestionResults.data?.map((suggestion, index) => <button type="button" role="option" id={`search-suggestion-${index}`} aria-selected={index === activeSuggestion} className={index === activeSuggestion ? 'is-active' : ''} key={suggestion} tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={() => { setInput(suggestion); setQuery(suggestion); setSuggestionsOpen(false); setActiveSuggestion(-1); }}><Icon name="search" size={16} /><span>{suggestion}</span><Icon name="arrow-left" size={14} className="suggestion-arrow" /></button>)}
      </div>}
    </div>
    <div className="search-scopes" role="group" aria-label="Search location">
      <button aria-pressed={scope === 'catalog'} className={scope === 'catalog' ? 'is-selected' : ''} onClick={() => setScope('catalog')}>Aurora Music</button>
      <button aria-pressed={scope === 'library'} className={scope === 'library' ? 'is-selected' : ''} onClick={() => setScope('library')}>Your Library</button>
    </div>
    {scope === 'catalog' && <div className="pill-row search-kinds" role="group" aria-label="Search category">{kinds.map(([value, label]) => <Pill key={value} selected={kind === value} onClick={() => setKind(value)} aria-pressed={kind === value}>{label}</Pill>)}</div>}

    {query ? <section className="search-results" aria-live="polite">
      {remote.isLoading && scope === 'catalog' && kind !== 'local' && <div className="search-loading">{[1, 2, 3, 4, 5].map((item) => <Skeleton key={item} className="row-skeleton" />)}</div>}
      {scope === 'catalog' && remote.isError && <ErrorState title="Search didn't finish" message={remote.error instanceof Error ? remote.error.message : 'Try again in a moment.'} retry={() => void remote.refetch()} />}
      {!(scope === 'catalog' && remote.isLoading) && !(scope === 'catalog' && remote.isError) && !results.length && <EmptyState icon="search" title={`No ${scope === 'library' ? 'library' : kind} results`}>{scope === 'library' ? 'Try another title, artist, or album in your saved music.' : 'Try a shorter title, another spelling, or a different category.'}</EmptyState>}
      {results.length > 0 && <>
        <div className="result-summary"><span>{scope === 'library' ? 'Your Library' : kind === 'song' ? 'Top Results' : `${kind[0].toUpperCase()}${kind.slice(1)}s`} · {results.length}</span>{tracks.length > 1 && <button className="text-button" onClick={() => usePlaybackStore.getState().playTracks(tracks, 0, `Search: ${query}`)}>Play all <Icon name="play" size={14} /></button>}</div>
        {tracks.length === results.length ? <div className="song-list">{tracks.map((track) => <SongRow key={track.id} track={track} context={[track]} contextLabel={`Search: ${query}`} index={0} />)}</div>
          : <div className="media-grid">{results.map((item, index) => <MediaCard key={`${item.id}-${index}`} item={item} context={tracks} contextLabel={`Search: ${query}`} />)}</div>}
      </>}
    </section> : <div className="search-idle">
      {scope === 'catalog' ? <>
        <section className="browse-categories"><header className="section-header"><div><h2>Browse Categories</h2><p>Find something for the mood you’re in.</p></div></header><div className="browse-category-grid">{browseCategories.map((item) => <button className={`browse-category category-${item.tone}`} key={item.title} onClick={() => chooseCategory(item.search)}><span>{item.title}</span><i aria-hidden="true" /></button>)}</div></section>
        {history.length > 0 && <section className="recent-searches"><header><h2>Recent searches</h2><button className="text-button" onClick={() => { setHistory([]); void setSetting('searches', []); }}>Clear</button></header><div>{history.map((item) => <button key={item} onClick={() => setInput(item)}><Icon name="clock" size={17} /><span>{item}</span><Icon name="chevron-right" size={15} /></button>)}</div></section>}
        {recent.length > 0 && <section className="search-recently-played"><header className="section-header"><h2>Recently played</h2></header><div className="song-list">{recent.slice(0, 5).map((track, index) => <SongRow key={track.id} track={track} context={recent} contextLabel="Recently played" index={index} />)}</div></section>}
      </> : <>
        <section className="library-search-intro"><span className="library-search-icon"><Icon name="library" /></span><div><h2>Search your library</h2><p>Find saved, liked, and recently played music on this device.</p></div></section>
        {recent.length > 0 && <section className="search-recently-played"><header className="section-header"><h2>Recently played</h2></header><div className="song-list">{recent.slice(0, 5).map((track, index) => <SongRow key={track.id} track={track} context={recent} contextLabel="Recently played" index={index} />)}</div></section>}
      </>}
    </div>}
  </div>;
}
