import { useEffect, useRef } from 'react';

/** One shared placement persists while navigating between pages. */
export function AdBanner() {
  const host = useRef<HTMLElement>(null);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const script = document.createElement('script');
    script.src = '/adcash-square.js';
    script.async = true;
    container.appendChild(script);
    return () => { container.replaceChildren(); };
  }, []);

  return <aside className="adcash-square" aria-label="Advertisement" ref={host} />;
}
