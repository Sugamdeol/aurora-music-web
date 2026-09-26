import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { MediaEntity, MediaTrack } from '../domain/media';
import { usePlaybackStore } from '../store/playback';
import { MediaCard } from '../components/Media';
import { ErrorState, PageHeader, Section, Skeleton } from '../components/primitives';
import { Icon } from '../components/Icon';

const slug = (value: string) => `explore-${value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

export function ExplorePage() {
  const explore = useQuery({
    queryKey: ['explore'],
    queryFn: ({ signal }) => api.explore(signal),
    staleTime: 10 * 60_000,
    retry: 1,
  });
  const sections = explore.data?.sections ?? [];
  const play = (items: Array<MediaEntity | MediaTrack>, label: string) => {
    const tracks = items.filter((item): item is MediaTrack => 'source' in item);
    if (tracks.length) usePlaybackStore.getState().playTracks(tracks, 0, label);
  };
  const jumpTo = (id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ behavior: document.documentElement.classList.contains('reduce-motion') ? 'auto' : 'smooth', block: 'start' });
  };

  return <div className="page explore-page">
    <PageHeader title="Explore" description="Charts, fresh releases, and the moods the catalog is pushing right now." />

    {explore.isError && <ErrorState title="Explore didn’t load" message={explore.error instanceof Error ? explore.error.message : 'Try again in a moment.'} retry={() => void explore.refetch()} />}

    {sections.length > 1 && <nav className="explore-jump" aria-label="Jump to a shelf">
      {sections.map((section) => <button key={section.id} type="button" className="plain-button explore-jump-chip" onClick={() => jumpTo(slug(section.id || section.title))}>{section.title}</button>)}
    </nav>}

    {explore.isLoading && <>
      {[1, 2, 3].map((block) => <Section key={block} title="Loading Explore"><div className="horizontal-shelf">{[1, 2, 3, 4, 5].map((item) => <Skeleton key={item} className="media-skeleton" />)}</div></Section>)}
    </>}

    {sections.map((section) => {
      const tracks = section.items.filter((item): item is MediaTrack => 'source' in item);
      return <Section
        key={section.id}
        title={section.title}
        className="explore-shelf"
        action={tracks.length ? <button className="text-button" onClick={() => play(section.items, section.title)}>Play all <Icon name="play" size={14} /></button> : undefined}
      >
        <div id={slug(section.id || section.title)} className="horizontal-shelf explore-anchor">
          {section.items.slice(0, 18).map((item, index) => <MediaCard key={`${item.id}-${index}`} item={item} context={tracks} contextLabel={section.title} />)}
        </div>
      </Section>;
    })}

    {!explore.isLoading && !explore.isError && !sections.length && <ErrorState title="Nothing to explore yet" message="The catalog returned no Explore shelves. Try again in a moment." retry={() => void explore.refetch()} />}
  </div>;
}
