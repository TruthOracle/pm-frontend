import { useSyncExternalStore, type ReactNode } from "react";
import StickyBox from "react-sticky-box";

/** Header (4.25rem) + category rail + breathing room, in px; matches `lg:top-28` we used before. */
const OFFSET_TOP = 112;
const OFFSET_BOTTOM = 16;
const QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const readDesktop = () => window.matchMedia(QUERY).matches;
const readServer = () => false;

/**
 * The trade column beside the page content. On desktop it behaves like a well-mannered
 * sidebar: it scrolls with the page, parks below the header when the page scrolls past it,
 * and — when it is taller than the viewport — parks on its bottom edge while scrolling down
 * and on its top edge while scrolling up, so every control is reachable through ordinary
 * page scrolling and there is never an inner scrollbar. Below `lg` it is plain flow content
 * under the page body.
 */
export function StickyColumn({ children, className }: { children: ReactNode; className?: string }) {
  const desktop = useSyncExternalStore(subscribe, readDesktop, readServer);
  if (!desktop) return <div className={className}>{children}</div>;
  return (
    <StickyBox offsetTop={OFFSET_TOP} offsetBottom={OFFSET_BOTTOM} className={className}>
      {children}
    </StickyBox>
  );
}
