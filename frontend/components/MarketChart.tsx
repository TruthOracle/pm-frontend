type MarketChartProps = {
  currentPrice: number;
};

const chartPoints = [
  [0, 118],
  [45, 110],
  [90, 118],
  [135, 79],
  [180, 88],
  [225, 68],
  [270, 77],
  [315, 46],
  [360, 58],
  [410, 29],
  [448, 38],
];

const linePath = chartPoints.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
const areaPath = `${linePath} L 448 150 L 0 150 Z`;

function MarketChart({ currentPrice }: MarketChartProps) {
  const priceLabel = `${Math.round(currentPrice * 100)}%`;

  return (
    <section className="market-chart-panel" aria-label="Market probability chart">
      <div className="market-chart-header">
        <div>
          <div className="market-chart-kicker">Probability history</div>
          <div className="market-chart-value">{priceLabel} <span>Yes</span></div>
        </div>
        <div className="market-chart-change">+4.8% <span>today</span></div>
      </div>

      <div className="market-chart-canvas">
        <div className="market-chart-grid" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="market-chart-y-axis" aria-hidden="true">
          <span>100%</span>
          <span>75%</span>
          <span>50%</span>
          <span>25%</span>
          <span>0%</span>
        </div>
        <svg viewBox="0 0 460 150" role="img" aria-label={`Probability is ${priceLabel}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="market-chart-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#16c784" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#16c784" stopOpacity="0" />
            </linearGradient>
            <filter id="market-chart-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <path d={areaPath} fill="url(#market-chart-area)" />
          <path d={linePath} fill="none" stroke="#16c784" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" filter="url(#market-chart-glow)" />
          <circle className="market-chart-endpoint" cx="448" cy="38" r="4" fill="#16c784" stroke="#16c784" strokeWidth="2" />
        </svg>
      </div>

      <div className="market-chart-axis" aria-hidden="true">
        <span>12:00</span>
        <span>16:00</span>
        <span>20:00</span>
        <span>Now</span>
      </div>

      <div className="market-chart-range" aria-label="Chart time range">
        <span className="market-chart-range-active">1D</span>
        <span>1W</span>
        <span>1M</span>
        <span>ALL</span>
      </div>
    </section>
  );
}

export default MarketChart;
