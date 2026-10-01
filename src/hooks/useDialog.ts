import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Shared modal behavior for every overlay (full player, sheets, dialogs):
 * Escape closes, Tab/Shift+Tab stay inside, focus returns to the opener, and
 * sibling app regions are inerted so keyboard and screen-reader users cannot
 * reach — or duplicate — the page beneath.
 */
export function useDialog<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    if (!node) return;

    const inerted: HTMLElement[] = [];
    if (node.parentElement) {
      for (const sibling of [...node.parentElement.children] as HTMLElement[]) {
        if (sibling !== node && !sibling.inert) {
          sibling.inert = true;
          inerted.push(sibling);
        }
      }
    }

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => [...node.querySelectorAll<HTMLElement>(FOCUSABLE)]
      .filter((element) => element.getClientRects().length > 0);

    const focusTimer = window.setTimeout(() => {
      const target = node.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0];
      (target ?? node).focus({ preventScroll: true });
    }, 30);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !node.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !node.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKey, true);
      for (const element of inerted) element.inert = false;
      previousFocus?.focus?.({ preventScroll: true });
    };
  }, [open]);

  return ref;
}
