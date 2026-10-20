/**
 * The order's history (`timeline`, compliance steps already removed by the server), oldest
 * first, with steps that read the same collapsed, times in UTC. The last step is the current one.
 */
import { formatDateTimeUTC } from "@/lib/time";
import { rampTimelineLabel, type RampOrder, type RampOrderStatus } from "@/lib/ramp";
import { collapseTimeline } from "@/lib/rampLogic";

export function RampTimeline({ order }: { order: RampOrder }) {
  const entries = collapseTimeline(order.timeline, (s) => rampTimelineLabel(order, s as RampOrderStatus));
  if (entries.length === 0) return null;
  return (
    <ol className="mt-4 space-y-2 border-l border-slate-200 pl-4" aria-label="Order history">
      {entries.map((e, i) => (
        <li key={`${e.status}-${e.at}`} className="relative text-xs">
          <span
            aria-hidden
            className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ${
              i === entries.length - 1 ? "bg-primary" : "bg-slate-300"
            }`}
          />
          <span className="font-medium text-slate-800">{e.label}</span>
          <span className="ml-2 text-slate-500">{formatDateTimeUTC(e.at)}</span>
        </li>
      ))}
    </ol>
  );
}

export default RampTimeline;
