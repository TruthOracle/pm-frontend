/**
 * One event in a grid (marketplace, homepage "Trending markets"), after Kalshi's event card:
 * category label and competition line, the title, when it closes (UTC), then the outcome table —
 * outcome with its probability underline, payout multiplier and odds pill — and a footer with the
 * event's volume and how many markets it has. The outcome rows share their logic with the
 * homepage trending board (`lib/outcomeRows.ts`), so both read the same way.
 */
import type { MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, Clock } from "lucide-react";
import { SERIES_PALETTE, compactAmount, formatPercent, marketColorMap } from "@/lib/chartData";
import { initialsOf, payoutMultiplier } from "@/lib/boardFormat";
import { barWidthPercent, outcomeRows, resultLabel, rowsHaveOwnImages } from "@/lib/outcomeRows";
import { eventInstrument, toNumber, type ApiEvent } from "@/lib/marketsTypes";
import { formatShortDateTimeUTC } from "@/lib/time";
import { cn } from "@/lib/utils";

function EventTile({ image, label }: { image: string; label: string }) {
  if (image) return <img src={image} alt="" className="ev-tile" loading="lazy" />;
  return (
    <span className="ev-tile ev-tile-initials" style={{ background: `linear-gradient(135deg, ${SERIES_PALETTE[0]} 0 50%, ${SERIES_PALETTE[1]} 50% 100%)` }} aria-hidden="true">
      {initialsOf(label)}
    </span>
  );
}

const stop = (e: MouseEvent) => e.stopPropagation();

/**
 * `showOutcomeImages={false}` keeps only the event's tile (Kalshi's homepage cards); the
 * marketplace shows each outcome's own image when every visible outcome has one.
 */
export default function EventCard({ event, showOutcomeImages = true }: { event: ApiEvent; showOutcomeImages?: boolean }) {
  const navigate = useNavigate();
  const markets = [...(event.markets ?? []).filter((m) => !m.archived)].sort((a, b) => toNumber(b.currentPrice) - toNumber(a.currentPrice));
  const colors = marketColorMap(markets);
  const { rows } = outcomeRows(event, markets, (t) => colors.get(t) ?? SERIES_PALETTE[0], { maxRows: 2, showAllUpTo: 3 });
  const showImages = showOutcomeImages && rowsHaveOwnImages(rows);
  const settled = event.status === "settled";
  const open = () => navigate(`/events/${event.ticker}`);
  const label = event.category || event.seriesTicker;

  return (
    <article
      className="ev-card"
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter") open();
      }}
      tabIndex={0}
      role="link"
      aria-label={event.title}
    >
      <div className="ev-top">
        <div className="flex min-w-0 items-center gap-2.5">
          <EventTile image={event.imageUrl} label={event.title} />
          <span className="ev-label">{label}</span>
        </div>
        {event.subTitle && (
          <span className="ev-sub" title={event.subTitle}>
            {event.subTitle}
          </span>
        )}
      </div>

      <h3 className="ev-title">{event.title}</h3>
      {settled ? (
        <p className="ev-meta">
          <CheckCircle2 className="h-3.5 w-3.5" /> Settled
        </p>
      ) : (
        event.closeTime && (
          <p className="ev-meta">
            <Clock className="h-3.5 w-3.5" /> Closes {formatShortDateTimeUTC(event.closeTime)}
          </p>
        )
      )}

      <ul className={cn("ev-rows", !showImages && "ev-rows-tight")} aria-label="Outcomes">
        {rows.length === 0 ? (
          <li className="ev-empty">No markets listed yet</li>
        ) : (
          rows.map((r) => (
            <li key={r.key} className="ev-row">
              <div className="flex min-w-0 items-center gap-3">
                {showImages && <img src={r.image} alt="" className="ev-icon" loading="lazy" />}
                <div className="ev-name">
                  <Link to={r.href} onClick={stop} className="ev-outcome" title={r.title}>
                    {r.label}
                  </Link>
                  <span className="ev-bar" aria-hidden="true">
                    <span style={{ width: `${barWidthPercent(r.price)}%`, background: r.color }} />
                  </span>
                </div>
              </div>
              <span className="ev-payout">{r.result ? "" : payoutMultiplier(r.price)}</span>
              {r.result ? (
                <span className={cn("ev-result", r.result === "won" ? "ev-result-won" : "ev-result-other")}>{resultLabel(r.result)}</span>
              ) : (
                <Link to={r.href} onClick={stop} className="ev-odds" aria-label={`${r.label}: ${formatPercent(r.price)} chance`}>
                  {formatPercent(r.price)}
                </Link>
              )}
            </li>
          ))
        )}
      </ul>

      <div className="ev-foot">
        <span>{compactAmount(event.volume, eventInstrument(event))} vol</span>
        <span>
          {markets.length} market{markets.length === 1 ? "" : "s"}
        </span>
      </div>
    </article>
  );
}
