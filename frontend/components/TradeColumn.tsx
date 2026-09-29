import { useSyncExternalStore, type ReactNode } from "react";
import StickyBox from "react-sticky-box";

/** Header + category rail + breathing room, in px (the old `lg:top-28`). */
const OFFSET_TOP = 112;
const OFFSET_BOTTOM = 16;
const DESKTOP = "(min-width: 1024px)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(DESKTOP);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const readDesktop = () => window.matchMedia(DESKTOP).matches;
const readServer = () => false;

/**
 * The trade column beside the page body. On desktop it moves with the page and parks at
 * whichever edge it reaches: scrolling down it stops when its bottom meets the viewport
 * bottom, scrolling up when its top meets the header. So the two columns start together at
 * the top of the page and end together at the bottom, every control is reachable through
 * ordinary page scrolling, and there is no inner scrollbar (react-sticky-box handles the
 * direction changes and columns taller than the viewport). Below `lg` it is flow content.
 */
export function TradeColumn({ children, className = "" }: { children: ReactNode; className?: string }) {
  const desktop = useSyncExternalStore(subscribe, readDesktop, readServer);
  if (!desktop) return <aside className={className}>{children}</aside>;
  return (
    <aside className="min-w-0">
      <StickyBox offsetTop={OFFSET_TOP} offsetBottom={OFFSET_BOTTOM} className={className}>
        {children}
      </StickyBox>
    </aside>
  );
}
