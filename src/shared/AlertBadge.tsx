interface Props { type: "large_bet" | "steady" | "drifting" }
const MAP = {
  large_bet: { label: "🐋 大戶落飛", cls: "bg-emerald-500/20 text-emerald-400 animate-pulse" },
  drifting:  { label: "📉 資金撤離", cls: "bg-red-500/20 text-red-400" },
  steady:    { label: "穩定",        cls: "bg-slate-700 text-slate-400" },
};
export function AlertBadge({ type }: Props) {
  const { label, cls } = MAP[type] ?? MAP.steady;
  return <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>;
}
