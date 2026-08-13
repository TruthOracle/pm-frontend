export default function MarketHistoryChart({ probability }: { probability: number }) {
  const marketChartMonth = new Date().toLocaleString(undefined, { month: "short" });

  return (
    <section className="market-history-card">
      <div className="mb-5 flex items-start justify-between border-b border-slate-100 pb-4">
        <div>
          <p className="eyebrow !mb-1">Probability history</p>
          <p className="text-3xl font-bold tracking-[-0.05em] text-slate-950">{Math.round(probability * 100)}% <span className="text-sm font-semibold tracking-normal text-slate-500">Yes</span></p>
        </div>
        <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">Live market</span>
      </div>
      <svg viewBox="0 0 940 230" className="mt-2 h-56 w-full" role="img" aria-label="Market probability history">
        <defs><linearGradient id="marketFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#138b61" stopOpacity=".18" /><stop offset="1" stopColor="#138b61" stopOpacity="0" /></linearGradient></defs>
        <path d="M0 178H880 M0 134H880 M0 90H880 M0 46H880 M0 2H880" className="chart-grid" />
        <path d="M0 158 C35 138 50 154 80 140 S125 125 150 134 S200 104 230 120 S275 92 305 106 S345 126 380 98 S425 82 455 92 S500 64 530 79 S575 60 605 72 S650 50 680 64 S730 80 755 58 S810 46 845 54 S865 36 880 30 V178 H0Z" fill="url(#marketFill)" />
        <path d="M0 158 C35 138 50 154 80 140 S125 125 150 134 S200 104 230 120 S275 92 305 106 S345 126 380 98 S425 82 455 92 S500 64 530 79 S575 60 605 72 S650 50 680 64 S730 80 755 58 S810 46 845 54 S865 36 880 30" className="chart-line" />
        <circle cx="880" cy="30" r="5" fill="#138b61" />
        {[100, 75, 50, 25, 0].map((label, index) => (
          <text key={label} x="895" y={6 + index * 44} className="market-chart-axis-label">{label}%</text>
        ))}
        <text x="0" y="220" className="market-chart-axis-label">{marketChartMonth}</text>
        <text x="846" y="220" className="market-chart-axis-label">Now</text>
      </svg>
      <div className="mt-5 flex items-center gap-1 rounded-xl bg-slate-50 p-1 text-xs font-bold text-slate-400"><button className="flex-1 rounded-lg bg-white py-2 text-slate-900 shadow-sm">1D</button><button className="flex-1 py-2">1W</button><button className="flex-1 py-2">1M</button><button className="flex-1 py-2">ALL</button></div>
    </section>
  );
}
