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
  return <span className={`artwork ${rounded ? 'artwork-round' : ''} ${className}`}>
    {src && !failed
      ? <img src={src} alt={props.alt ?? ''} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} {...props} />
      : <span className="artwork-fallback"><Icon name="music" size={28} /><i>{title.slice(0, 1).toUpperCase()}</i></span>}
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
