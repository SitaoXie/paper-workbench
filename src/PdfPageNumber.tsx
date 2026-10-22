import { useEffect, useRef, useState } from 'react';

/** Let a page number be edited without navigating through each partial digit. */
export default function PdfPageNumber({ page, total, disabled, label, onNavigate }: {
  page: number;
  total: number;
  disabled?: boolean;
  label: string;
  onNavigate: (page: number) => void;
}) {
  const [draft, setDraft] = useState(String(page));
  const dirty = useRef(false);
  useEffect(() => { if (!dirty.current) setDraft(String(page)); }, [page]);
  useEffect(() => { dirty.current = false; setDraft(String(page)); }, [total, disabled]);
  const commit = () => {
    if (!dirty.current) return;
    dirty.current = false;
    const target = /^\d+$/.test(draft) ? Number(draft) : NaN;
    if (Number.isSafeInteger(target) && target >= 1 && target <= total) {
      setDraft(String(target));
      if (target !== page) onNavigate(target);
    } else setDraft(String(page));
  };
  return <input type="number" inputMode="numeric" aria-label={label} min={1} max={total}
    value={draft} disabled={disabled}
    onChange={event => { dirty.current = true; setDraft(event.target.value); }}
    onBlur={commit}
    onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); commit(); event.currentTarget.blur(); }
      else if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); dirty.current = false;
        setDraft(String(page)); event.currentTarget.blur();
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault(); dirty.current = false;
        const target = Math.max(1, Math.min(total, page + (event.key === 'ArrowUp' ? 1 : -1)));
        setDraft(String(target)); if (target !== page) onNavigate(target);
      }
    }} />;
}
