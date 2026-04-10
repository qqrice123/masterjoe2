interface Props { pools: { WIN?: number; PLA?: number; QIN?: number; QPL?: number; DBL?: number } }

function fmt(n?: number) {
  if (!n) return "—";
  return n >= 1_000_000 ? `$${(n/1_000_000).toFixed(1)}M` : `$${(n/1000).toFixed(0)}K`;
}

export function PoolSummary({ pools }: Props) {
  const items = [
    { label: "獨贏 WIN",  value: pools.WIN,  color: "text-emerald-400" },
    { label: "位置 PLA",  value: pools.PLA,  color: "text-blue-400" },
    { label: "連贏 QIN",  value: pools.QIN,  color: "text-purple-400" },
    { label: "位置Q QPL", value: pools.QPL,  color: "text-yellow-400" },
    { label: "孖寶 DBL",  value: pools.DBL,  color: "text-orange-400" },
  ];
  return (
    <div className="bg-[#161b27] rounded-xl border border-[#2a3352] px-4 py-3">
      <div className="text-xs text-slate-500 mb-2 font-medium">💰 彩池總額（即時）</div>
      <div className="flex flex-wrap gap-4">
        {items.map(({ label, value, color }) => (
          <div key={label} className="flex flex-col">
            <span className="text-[10px] text-slate-500">{label}</span>
            <span className={`text-sm font-bold font-mono ${color}`}>{fmt(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
