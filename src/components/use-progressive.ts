'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Windowed incremental rendering. Renders only the first `count` items and
 * grows the window as a bottom sentinel scrolls into view, so a list of
 * thousands (e.g. a 1456-block conversation) paints its first screen instantly
 * instead of mounting every item up front. Variable item heights and
 * window-level scrolling both work, since real DOM nodes are what gets
 * observed. `rootMargin` pre-loads the next batch before the user reaches the
 * end, keeping scrolling seamless.
 */
export function useProgressive(total: number, step = 40, initial = 40) {
  const [count, setCount] = useState(() => Math.min(initial, total));
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Reset when the underlying list changes (e.g. navigating to another session)
  useEffect(() => {
    setCount(Math.min(initial, total));
  }, [total, initial]);

  useEffect(() => {
    if (count >= total) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) {
          setCount(c => Math.min(c + step, total));
        }
      },
      { rootMargin: '800px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [count, total, step]);

  return { count, sentinelRef };
}
