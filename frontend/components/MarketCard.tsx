import { useNavigate } from "react-router-dom";
import { getCurrentPrice, formatCents } from "@/lib/marketPricing";
import { cn } from "@/lib/utils";
import { TrendingUp, CheckCircle2 } from "lucide-react";

export type MarketCardProps = {
  id: string | number;
  question: string;
  imageUrl: string;
  status: 0 | 1;
  result?: "Yes" | "No" | "Draw" | string;
  yesShares?: number;
  noShares?: number;
  liquidityParam?: number;
};

const MarketCard = (props: MarketCardProps) => {
  const navigate = useNavigate();
  const statusParam = props.status === 0 ? "active" : "resolved";
  const handleCardClick = () => navigate(`/market/${props.id}?status=${statusParam}`);

  const price =
    props.status === 0 && props.yesShares != null && props.noShares != null
      ? getCurrentPrice(props.yesShares, props.noShares, props.liquidityParam ?? 1)
      : null;

  const yesPct = price ? Math.round(price.yes * 100) : 50;

  const resultLabel = (() => {
    if (props.status === 0) return null;
    if (props.result === "Yes") return "Yes Won";
    if (props.result === "No") return "No Won";
    if (props.result === "Draw") return "Draw";
    return "Resolved";
  })();

  const handleOutcomeClick = (e: React.MouseEvent, side: "yes" | "no") => {
    e.stopPropagation();
    navigate(`/market/${props.id}?status=${statusParam}&side=${side}`);
  };

  return (
    <article
      className="market-card cursor-pointer p-4"
      onClick={handleCardClick}
    >
      {/* Header row */}
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary ring-1 ring-border">
          {props.imageUrl ? (
            <img
              src={props.imageUrl}
              alt=""
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <TrendingUp className="h-4 w-4 text-primary" />
          )}
        </div>
        <h3 className="line-clamp-2 flex-1 text-sm font-semibold leading-snug text-foreground">
          {props.question}
        </h3>
      </div>

      {props.status === 0 ? (
        <>
          {/* Probability display */}
          <div className="mb-3">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-oracle-yes">{yesPct}%</span>
              <span className="text-xs text-muted-foreground">chance of Yes</span>
            </div>
            <div className="prob-bar">
              <div className="prob-bar-yes" style={{ width: `${yesPct}%` }} />
            </div>
          </div>

          {/* Yes / No buttons */}
          <div className="flex gap-2">
            <button
              className="btn-yes"
              onClick={(e) => handleOutcomeClick(e, "yes")}
            >
              Yes {price ? formatCents(price.yes) : "—"}
            </button>
            <button
              className="btn-no"
              onClick={(e) => handleOutcomeClick(e, "no")}
            >
              No {price ? formatCents(price.no) : "—"}
            </button>
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2.5">
          <CheckCircle2
            className={cn(
              "h-4 w-4 shrink-0",
              props.result === "Yes" && "text-oracle-yes",
              props.result === "No" && "text-oracle-no",
              props.result === "Draw" && "text-muted-foreground"
            )}
          />
          <span className="text-sm font-medium text-foreground">{resultLabel}</span>
          <span className="ml-auto text-xs text-muted-foreground">
            Final: {yesPct}% Yes
          </span>
        </div>
      )}
    </article>
  );
};

export default MarketCard;
