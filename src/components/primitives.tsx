import { useEffect, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ImgHTMLAttributes, type PropsWithChildren, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function GlassSurface({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`glass-surface ${className}`} {...props} />;
}

interface ArtworkProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src?: string;
  title?: string;
  rounded?: boolean;
}
export function Artwork({ src, title = '', rounded = false, className = '', ...props }: ArtworkProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const seed = [...title].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 7);
  const palettes = [
    ['#c87954', '#e5c99c', '#303a32'], ['#9cae91', '#d8d1b4', '#38473b'],
    ['#aab9c4', '#e0d2b8', '#42505a'], ['#d0a74c', '#efe0b8', '#453b2e'],
    ['#aa8292', '#e2c8ae', '#493b49'],
  ];
  const [ink, paper, dark] = palettes[seed % palettes.length];
  const shape = seed % 3;
  return <span className={`artwork ${rounded ? 'artwork-round' : ''} ${className}`}>
    {src && !failed
      ? <img src={src} alt={props.alt ?? ''} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} {...props} />
      : <span className="artwork-fallback" aria-hidden="true">
        <svg viewBox="0 0 120 120" focusable="false">
          <rect width="120" height="120" fill={paper} />
          {shape === 0 && <><circle cx="78" cy="43" r="31" fill={ink} /><circle cx="78" cy="43" r="19" fill={paper} /><path d="M0 91 48 42l26 26 18-18 28 28v42H0Z" fill={dark} /><path d="m0 103 48-44 30 29 18-19 24 25v26H0Z" fill={ink} /></>}
          {shape === 1 && <><path d="M0 0h69v120H0z" fill={ink} /><path d="M17 17h86v72H17z" fill={dark} /><path d="M28 28h64v50H28z" fill={paper} /><path d="M0 99h120v21H0z" fill={dark} /><circle cx="60" cy="53" r="17" fill={ink} /></>}
          {shape === 2 && <><path d="M-12 27 92-13l40 104-104 40z" fill={ink} /><path d="m7 34 73-28 25 65-73 28z" fill={paper} /><path d="M0 91h120v29H0z" fill={dark} /><path d="M12 103h37m10 0h14m10 0h26" stroke={ink} strokeWidth="4" /></>}
          <path d="M10 10h100v100H10z" fill="none" stroke={dark} strokeOpacity=".35" />
        </svg>
        <i>{title.trim().slice(0, 1).toUpperCase() || 'A'}</i>
      </span>}
  </span>;
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  active?: boolean;
  size?: 'small' | 'normal' | 'large';
}
export function IconButton({ icon, label, active, size = 'normal', className = '', ...props }: IconButtonProps) {
  return <button type="button" className={`icon-button icon-button-${size} ${active ? 'is-active' : ''} ${className}`} aria-label={label} title={label} {...props}><Icon name={icon} /></button>;
}

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}
export function EmptyState({ icon = 'music', title, children, action }: EmptyStateProps) {
  return <div className="empty-state"><span className="empty-state-icon"><Icon name={icon} /></span><div><h2>{title}</h2><p>{children}</p>{action && <div className="empty-state-action">{action}</div>}</div></div>;
}

export function ErrorState({ title = "Couldn't load music", message, retry }: { title?: string; message: string; retry?: () => void }) {
  return <div className="error-state" role="alert"><span><Icon name="wifi" /></span><div><h2>{title}</h2><p>{message}</p></div>{retry && <button className="text-button" onClick={retry}>Try again</button>}</div>;
}

export function Skeleton({ className = '' }: { className?: string }) { return <div className={`skeleton ${className}`} aria-hidden="true" />; }

export function Section({ title, action, children, className = '' }: PropsWithChildren<{ title: string; action?: ReactNode; className?: string }>) {
  return <section className={`content-section ${className}`}><header className="section-header"><h2>{title}</h2>{action}</header>{children}</section>;
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <header className="page-header"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</header>;
}

export function Pill({ children, selected, ...props }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }>) {
  return <button type="button" className={`pill ${selected ? 'is-selected' : ''}`} {...props}>{children}</button>;
}
