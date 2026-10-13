import { useEffect, useState } from 'react';
import type { MediaTrack } from '../domain/media';
import { downloadTrack, songShareUrl, startTrackRadio } from '../lib/trackActions';
import { Icon } from './Icon';

export function TrackActions({ track, menu = false, onComplete }: { track: MediaTrack; menu?: boolean; onComplete?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState('');
  const [copyLink, setCopyLink] = useState('');
  useEffect(() => { setMessage(''); setCopyLink(''); setDownloading(false); }, [track.id]);
  if (track.source === 'local') return null;
  const radio = async () => {
    if (busy) return;
    setBusy(true); setMessage('');
    try { if (await startTrackRadio(track)) onComplete?.(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Radio could not be started.'); }
    finally { setBusy(false); }
  };
  const share = async () => {
    const url = songShareUrl(track);
    setMessage('');
    try {
      if (navigator.share) { await navigator.share({ title: track.title, text: `${track.title} · ${track.artist}`, url }); }
      else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); setMessage('Song link copied.'); }
      else setCopyLink(url);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setCopyLink(url);
    }
  };
  // The menu stays open on purpose so the saved/failed status is visible.
  const download = async () => {
    if (downloading) return;
    setDownloading(true); setMessage('');
    try { await downloadTrack(track); setMessage('Saved to your downloads.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'The download could not be started.'); }
    finally { setDownloading(false); }
  };
  return <div className={menu ? 'track-actions-menu' : 'track-actions'}>
    <button role={menu ? 'menuitem' : undefined} disabled={busy} onClick={() => void radio()}><Icon name="radio" size={16} /><span>{busy ? 'Finding radio…' : 'Start radio'}</span></button>
    <button role={menu ? 'menuitem' : undefined} disabled={downloading} onClick={() => void download()}><Icon name="download" size={16} /><span>{downloading ? 'Downloading…' : 'Download'}</span></button>
    <button role={menu ? 'menuitem' : undefined} onClick={() => void share()}><Icon name="share" size={16} /><span>Share song</span></button>
    {message && <p className="track-action-message" role="status">{message}</p>}
    {copyLink && <label className="track-share-link">Copy song link<input readOnly value={copyLink} onFocus={(event) => event.target.select()} /></label>}
  </div>;
}
