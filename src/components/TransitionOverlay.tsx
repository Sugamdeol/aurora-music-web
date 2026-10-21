import { usePlaybackStore } from '../store/playback';
import { Artwork } from './primitives';

/**
 * The Auto Mix transition indicator, in the style of Apple Music's
 * blend animation.
 *
 * While two songs are blending, the outgoing artwork shrinks away and the
 * incoming one grows into place, and a ring around the incoming artwork
 * fills with the blend's progress. The overlay sits above the artwork and
 * disappears when the blend finishes.
 */

export function TransitionRing({ size = 30, progress }: { size?: number; progress: number }) {
  const radius = (size - 4) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(0, Math.min(1, progress)) * circumference;
  return <svg className="transition-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
    <circle className="transition-ring-track" cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth="2.5" />
    <circle
      className="transition-ring-fill"
      cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth="2.5"
      strokeLinecap="round"
      strokeDasharray={circumference}
      strokeDashoffset={circumference - filled}
      transform={`rotate(-90 ${size / 2} ${size / 2})`}
    />
  </svg>;
}

/** Compact badge for the mini player: ring around the incoming artwork. */
export function DockTransitionBadge() {
  const transition = usePlaybackStore((state) => state.transition);
  if (!transition.active) return null;
  return <span className="dock-transition" style={{ '--transition-progress': transition.progress } as React.CSSProperties}>
    <TransitionRing size={26} progress={transition.progress} />
    <span className="dock-transition-label">AutoMix</span>
  </span>;
}

/**
 * The divider Apple Music draws in the up-next queue where a blend will
 * happen: a shimmering accent line labeled "Transition".
 */
export function TransitionDivider() {
  return <div className="queue-transition-divider" role="separator" aria-label="Auto Mix will blend these songs">
    <span className="queue-transition-line" />
    <span className="queue-transition-label">Transition</span>
    <span className="queue-transition-line" />
  </div>;
}

/**
 * Large overlay for the full player: both artworks blend with the same
 * equal-power curve the audio uses, so what you see matches what you hear.
 */
export function FullPlayerTransition() {
  const transition = usePlaybackStore((state) => state.transition);
  if (!transition.active || !transition.from || !transition.to) return null;
  const progress = Math.max(0, Math.min(1, transition.progress));
  return <div className="automix-overlay" style={{ '--transition-progress': progress } as React.CSSProperties} role="status" aria-label="Auto Mix blending the next song">
    <div className="automix-artworks">
      <div className="automix-artwork automix-outgoing"><Artwork src={transition.from.artwork} title={transition.from.title} loading="lazy" /></div>
      <div className="automix-artwork automix-incoming"><Artwork src={transition.to.artwork} title={transition.to.title} loading="eager" /></div>
    </div>
    <div className="automix-pill">
      <TransitionRing size={22} progress={progress} />
      <span>AutoMix</span>
    </div>
  </div>;
}
