import { useEffect, useRef, type ReactNode } from 'react';
export function Modal({
  title,
  close,
  children,
  wide = false,
  className = '',
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const viewport = window.visualViewport;
    const fit = () => {
      if (!viewport || !ref.current) return;
      ref.current.style.setProperty('--fdu-dialog-height', `${viewport.height}px`);
      ref.current.parentElement!.style.bottom = `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`;
    };
    fit();
    viewport?.addEventListener('resize', fit);
    viewport?.addEventListener('scroll', fit);
    const key = (e: KeyboardEvent) => {
      const top = [
        ...document.querySelectorAll<HTMLElement>('[role="dialog"],[role="alertdialog"]'),
      ]
        .filter((el) => el.getClientRects().length)
        .at(-1);
      if (top && top !== ref.current) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      }
      if (e.key !== 'Tab') return;
      const nodes = [
        ...(ref.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]',
        ) ?? []),
      ].filter((el) => el.getClientRects().length);
      const first = nodes[0],
        last = nodes.at(-1);
      if (
        e.shiftKey &&
        (document.activeElement === first || document.activeElement === ref.current)
      ) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => {
      document.body.style.overflow = before;
      viewport?.removeEventListener('resize', fit);
      viewport?.removeEventListener('scroll', fit);
      window.removeEventListener('keydown', key, true);
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <section
        ref={ref}
        tabIndex={-1}
        className={`settings-modal${wide ? ' settings-modal-models' : ''} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="detail-heading">
          <h2>{title}</h2>
          <button aria-label={`关闭${title}`} onClick={close}>
            ✕
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
