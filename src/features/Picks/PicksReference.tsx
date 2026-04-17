import { RaceDetail, Prediction } from "@/services/api";

interface Props {
  raceDetail: RaceDetail;
}

export function PicksReference({ raceDetail }: Props) {
  const { predictions, going } = raceDetail;

  // We sort by score (or EV) to select the top 4
  const validRunners = (predictions || []).filter(p => !String(p.runnerNumber).startsWith("R"));
  const ranked = [...validRunners].sort((a, b) => b.score - a.score);
  const top4 = ranked.slice(0, 4);

  return (
    <div className="bg-[#161b27] rounded-xl border border-[#2a3352] p-4 overflow-x-auto">
      <h2 className="text-sm font-semibold text-slate-200 mb-2">🎯 四維度整合分析框架 - 臨場微調分析</h2>
      <p className="text-xs text-slate-400 mb-4">
        結合步速預測與檔位群組走勢做臨場微調分析上仗與今仗評分與負磅變化 ({going || "未知場地"})
      </p>

      <div className="min-w-[800px]">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[#2a3352] text-slate-400">
              <th className="py-2 pr-2 font-medium">馬號</th>
              <th className="py-2 pr-2 font-medium">馬匹名稱</th>
              <th className="py-2 pr-2 font-medium">今仗評分</th>
              <th className="py-2 pr-2 font-medium">評分變化</th>
              <th className="py-2 pr-2 font-medium">今仗負磅</th>
              <th className="py-2 pr-2 font-medium">負磅變化</th>
              <th className="py-2 pr-2 font-medium">今仗體重</th>
              <th className="py-2 pr-2 font-medium">體重變化</th>
              <th className="py-2 pr-2 font-medium">累積相對負擔</th>
              <th className="py-2 pr-2 font-medium">時間差</th>
              <th className="py-2 pr-2 font-medium min-w-[120px]">近3仗賽績</th>
              <th className="py-2 pr-2 font-medium min-w-[150px]">優劣分析</th>
              <th className="py-2 pr-2 font-medium">評級名次(順序)</th>
            </tr>
          </thead>
          <tbody className="text-slate-300">
            {top4.map((p, i) => {
              // Extract or mock some data if it doesn't exist in Prediction yet
              const currentRating = p.rating || "—";
              const ratingChange = "—"; // Not in current API
              const currentWeight = p.weight || "—";
              const weightChange = "—"; // Not in current API
              const currentHorseWeight = p.horseWeight || "—";
              const horseWeightChange = "—"; // Not in current API
              const cumulativeBurden = p.weightRD ? p.weightRD.toFixed(1) : "—";
              const timeDiff = p.timeAdvantage != null ? p.timeAdvantage.toFixed(2) : "—";
              const prosCons = p.riskFactors?.length ? `缺點: ${p.riskFactors.join(", ")}` : (p.combatAdvice || "—");

              return (
                <tr key={p.runnerNumber} className="border-b border-[#2a3352]/50 hover:bg-slate-800/30 transition-colors">
                  <td className="py-3 pr-2 font-bold text-blue-400">#{p.runnerNumber}</td>
                  <td className="py-3 pr-2 font-medium text-white">{p.runnerName}</td>
                  <td className="py-3 pr-2">{currentRating}</td>
                  <td className="py-3 pr-2 text-slate-500">{ratingChange}</td>
                  <td className="py-3 pr-2">{currentWeight}</td>
                  <td className="py-3 pr-2 text-slate-500">{weightChange}</td>
                  <td className="py-3 pr-2">{currentHorseWeight}</td>
                  <td className="py-3 pr-2 text-slate-500">{horseWeightChange}</td>
                  <td className="py-3 pr-2 text-amber-400/80">{cumulativeBurden}</td>
                  <td className={`py-3 pr-2 ${p.timeAdvantage < 0 ? "text-emerald-400" : "text-red-400"}`}>{timeDiff}</td>
                  <td className="py-3 pr-2 font-mono text-[10px]">{p.last3Form || "—"}</td>
                  <td className="py-3 pr-2 text-[10px] text-slate-400">{prosCons}</td>
                  <td className="py-3 pr-2 font-bold">
                    {i === 0 ? "🥇 第1名" : i === 1 ? "🥈 第2名" : i === 2 ? "🥉 第3名" : "第4名"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
