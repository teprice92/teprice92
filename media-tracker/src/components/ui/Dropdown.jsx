import { useEffect, useRef, useState } from 'react';

/**
 * Minimal accessible dropdown: `trigger` is a render prop receiving
 * { open, toggle }; children render inside the popover panel and receive
 * `close` to dismiss after selection.
 */
export function Dropdown({ trigger, align = 'right', children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          className={`glass card-shadow-lg absolute z-30 mt-2 min-w-44 overflow-hidden rounded-xl border border-edge py-1 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {typeof children === 'function'
            ? children({ close: () => setOpen(false) })
            : children}
        </div>
      )}
    </div>
  );
}
