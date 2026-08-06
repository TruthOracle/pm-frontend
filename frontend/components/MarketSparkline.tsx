type MarketSparklineProps = {
  currentPrice?: number;
};

function MarketSparkline({ currentPrice = 0.68 }: MarketSparklineProps) {
  const priceLabel = `${Math.round(currentPrice * 100)}%`;

  return (
    <div className="market-sparkline" aria-label="Live market probability chart">
      <div className="market-sparkline-labels" aria-hidden="true">
        <span>100%</span>
        <span>75%</span>
        <span>50%</span>
        <span>25%</span>
        <span>0%</span>
      </div>
      <div className="market-sparkline-plot">
        <div className="market-sparkline-grid" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <svg viewBox="0 0 460 150" role="img" aria-label={`Live market probability at ${priceLabel} Yes`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="home-market-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#16c784" stopOpacity="0.23" />
              <stop offset="100%" stopColor="#16c784" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M 0 118 L 45 110 L 90 118 L 135 79 L 180 88 L 225 68 L 270 77 L 315 46 L 360 58 L 410 29 L 448 38 L 448 150 L 0 150 Z" fill="url(#home-market-area)" />
          <path d="M 0 118 L 45 110 L 90 118 L 135 79 L 180 88 L 225 68 L 270 77 L 315 46 L 360 58 L 410 29 L 448 38" fill="none" stroke="#16c784" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <circle className="market-sparkline-endpoint" cx="448" cy="38" r="4" fill="#16c784" stroke="#16c784" strokeWidth="2" />
        </svg>
      </div>
    </div>
  );
}

export default MarketSparkline;
