import { Prediction } from "@/services/api";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface Props { predictions: Prediction[] }

const COLORS = ["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#ec4899"];

export function MoneyFlowChart({ predictions }: Props) {
  const withHistory = predictions
    .filter(p => p.oddsHistory && p.expectedValue > 0)
    .slice(0, 5);

  if (!withHistory.length) return null;

  const labels = ["夜", "前30分", "前15分", "即時"];
  const keys   = ["overnight", "min30", "min15", "current"] as const;

  const chartData = labels.map((label, i) => {
    const point: Record<string, number | string> = { label };
    withHistory.forEach(p => {
      const v = parseFloat(String(p.oddsHistory![keys[i]]));
      if (!isNaN(v)) point[p.runnerName.slice(0,4)] = v;
    });
    return point;
  });

  const alerts = predictions.filter(p => {
    const hist = p.oddsHistory;
    if (!hist) return false;
    const drop = (parseFloat(String(hist.overnight)) - parseFloat(String(hist.current))) /
                  parseFloat(String(hist.overnight));
    return drop >= 0.30;
  });

  return (
    <div className="bg-[#161b27] rounded-xl border border-[#2a3352] p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-200">📈 賠率走勢（+EV 馬匹）</h2>
        {alerts.length > 0 && (
          <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded-full animate-pulse">
            🐋 {alerts.map(a => `${a.runnerNumber}號 ${a.runnerName.slice(0,3)}`).join(" / ")} 大戶落飛
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData}>
          <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} />
          <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} reversed />
          <Tooltip
            contentStyle={{ background: "#1c2333", border: "1px solid #2a3352", borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: "#94a3b8" }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {withHistory.map((p, i) => (
            <Line
              key={p.runnerNumber}
              type="monotone"
              dataKey={p.runnerName.slice(0,4)}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-3 text-xs text-slate-500">賠率下跌 = 資金湧入；Y軸由下至上為賠率縮短</div>
    </div>
  );
}
