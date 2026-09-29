import { useEffect, useRef, type ReactNode } from "react";

/**
 * The trade column beside the page body (`.trade-column` in index.css does the sticky /
 * self-scrolling part). This adds the two rules that keep it feeling like one page:
 *
 * - While the column is not yet pinned under the header (the page is near the top), wheel
 *   input over it scrolls the PAGE, not the column — otherwise the column's own content
 *   would slide up under nothing and look clipped.
 * - Once the column is pinned, the wheel scrolls it first (native overflow behaviour) and
 *   the browser chains to the page when it reaches either end.
 * - When the page scrolls back up far enough to unpin the column, its inner scroll resets to
 *   the start, so arriving at the top always shows the column from its first card.
 */
export function TradeColumn({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stickyTop = () => {
      const top = parseFloat(getComputedStyle(el).top);
      return Number.isFinite(top) ? top : 0;
    };
    const pinned = () => getComputedStyle(el).position === "sticky" && el.getBoundingClientRect().top <= stickyTop() + 1;

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY > 0 && !pinned()) {
        e.preventDefault();
        window.scrollBy({ top: e.deltaY, left: 0 });
      }
    };
    const onPageScroll = () => {
      if (!pinned() && el.scrollTop !== 0) el.scrollTop = 0;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("scroll", onPageScroll, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("scroll", onPageScroll);
    };
  }, []);

  return (
    <aside ref={ref} className={`trade-column ${className}`.trim()}>
      {children}
    </aside>
  );
}
