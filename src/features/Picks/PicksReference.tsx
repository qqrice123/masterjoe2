import { RaceDetail, Prediction } from "@/services/api";

interface Props {
  raceDetail: RaceDetail;
}

function getDistanceCoeff(dist: number): number {
  if (dist <= 1200) return 0.055;
  if (dist <= 1650) return 0.11;
  if (dist <= 2000) return 0.16;
  return 0.22;
}

export function PicksReference({ raceDetail }: Props) {
  const { predictions, going, distance = 1200 } = raceDetail;

  // We sort by score (or EV) to select the top 4
  const validRunners = (predictions || []).filter(p => !String(p.runnerNumber).startsWith("R"));
  const ranked = [...validRunners].sort((a, b) => b.score - a.score);
  const top4 = ranked.slice(0, 4);

  if (top4.length === 0) {
    return (
      <div className="bg-[#161b27] rounded-xl border border-[#2a3352] p-8 text-center text-slate-500 text-sm">
        賽駒資料不足，無法產生預測參考
      </div>
    );
  }

  // 第四維度：與基準負磅比較 (系統預設為 125 磅)
  const BASE_WEIGHT = 125;

  let gMod = 1.05; // Default: Good (好地)
  if (going) {
    if (going.includes("好至快")) gMod = 1.00;
    else if (going.includes("快") || going.toLowerCase().includes("firm")) gMod = 1.00;
    else if (going.includes("好至黏") || going.includes("黏") || going.toLowerCase().includes("yielding")) gMod = 1.15;
    else if (going.includes("軟") || going.includes("爛") || going.toLowerCase().includes("soft")) gMod = 1.30;
    else if (going.includes("好") || going.toLowerCase().includes("good")) gMod = 1.05;
  }

  return (
    <div className="bg-[#161b27] rounded-xl border border-[#2a3352] p-4 overflow-x-auto">
      <h2 className="text-sm font-semibold text-slate-200 mb-2">🎯 四維度整合分析框架 - 臨場微調分析</h2>
      <p className="text-xs text-slate-400 mb-4">
        結合步速預測與檔位群組走勢做臨場微調分析上仗與今仗評分與負磅變化 ({going || "未知場地"})
      </p>

      <div className="overflow-x-auto mt-4 -mx-4 sm:mx-0">
        <table className="w-full text-left border-collapse text-sm min-w-[1000px]">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="px-3 py-2.5 font-medium text-slate-400 whitespace-nowrap">馬號</th>
              <th className="px-3 py-2.5 font-medium text-slate-400 whitespace-nowrap">馬匹名稱</th>
              <th className="px-3 py-2.5 font-medium text-slate-400 whitespace-nowrap">今仗評分</th>
              <th className="px-3 py-2.5 font-medium text-slate-400 whitespace-nowrap">評分變化</th>
              <th className="px-3 py-2.5 font-medium text-slate-400 whitespace-nowrap">今仗負磅</th>
              <th className="px-3 py-2.5 font-medium text-slate-400 whitespace-nowrap">負磅變化</th>
              <th className="px-3 py-2.5 font-medium text-slate-400 whitespace-nowrap">今仗體重</th>
              <th className="px-3 py-2.5 font-medium text-slate-400 whitespace-nowrap">體重變化</th>
              <th className="px-3 py-2.5 font-medium text-slate-400 whitespace-nowrap">累積相對負擔</th>
              <th className="px-3 py-2.5 font-medium text-slate-400 whitespace-nowrap">時間差</th>
              <th className="px-3 py-2.5 font-medium text-slate-400 whitespace-nowrap min-w-[100px]">近3仗賽績</th>
              <th className="px-3 py-2.5 font-medium text-slate-400 whitespace-nowrap min-w-[180px]">優劣分析</th>
              <th className="px-3 py-2.5 font-medium text-slate-400 whitespace-nowrap">評級名次(順序)</th>
            </tr>
          </thead>
          <tbody className="text-slate-300">
            {top4.map((p, i) => {
              const currentRating = p.rating ?? "—";
              const prevRating = p.prevRating ?? p.rating;
              const ratingChange = p.rating != null && prevRating != null && p.rating !== prevRating
                ? (p.rating - prevRating > 0 ? `+${p.rating - prevRating}` : `${p.rating - prevRating}`)
                : "—";

              const currentWeight = p.weight ?? "—";
              const prevWeight = p.prevWeight ?? p.weight;
              const weightChange = p.weight != null && prevWeight != null && p.weight !== prevWeight
                ? (p.weight - prevWeight > 0 ? `+${p.weight - prevWeight}` : `${p.weight - prevWeight}`)
                : "—";

              const currentHorseWeight = p.horseWeight ?? "—";
              const prevHorseWeight = p.prevHorseWeight ?? p.horseWeight;
              const horseWeightChange = p.horseWeight != null && prevHorseWeight != null && p.horseWeight !== prevHorseWeight
                ? (p.horseWeight - prevHorseWeight > 0 ? `+${p.horseWeight - prevHorseWeight}` : `${p.horseWeight - prevHorseWeight}`)
                : "—";

              // 第二維度：WeightRD 累積相對負擔
              const cumulativeBurden = p.weight && p.horseWeight
                ? ((p.weight / p.horseWeight) * distance).toFixed(1)
                : "—";

              // 第四維度：時間差 (與場均負磅比較)
              const deltaW = BASE_WEIGHT - (p.weight ?? BASE_WEIGHT);
              const c = getDistanceCoeff(distance);
              const sMod = p.runningStyle === "front" ? 0.95 : p.runningStyle === "back" ? 1.05 : 1.00;
              const timeDiffVal = (deltaW / 2) * c * gMod * sMod;
              const timeDiff = timeDiffVal > 0
                ? `+${timeDiffVal.toFixed(3)}秒 ✅`
                : timeDiffVal < 0
                ? `${timeDiffVal.toFixed(3)}秒 ⚠️`
                : "持平";

              // 優劣分析（prosCons）
              const burdenRatio = p.weight && p.horseWeight ? (p.weight / p.horseWeight) * 100 : null;
              const pros: string[] = [];
              const cons: string[] = [];
              
              if (burdenRatio && burdenRatio < 11) pros.push("輕負擔✅");
              if (burdenRatio && burdenRatio > 12.5) cons.push("重負擔⚠️");
              if (p.rating && prevRating && p.rating > prevRating) pros.push("評分升📈");
              if (p.rating && prevRating && p.rating < prevRating) cons.push("評分降📉");
              if (p.weight && prevWeight && p.weight > prevWeight) cons.push("加磅⚠️");
              if (p.weight && prevWeight && p.weight < prevWeight) pros.push("減磅✅");
              
              if (p.riskFactors?.length) cons.push(...p.riskFactors);

              const prosCons = [...pros, ...cons].join(" ") || "—";
              
              const hasNoOdds = p.winOdds === "—" || p.winOdds == null;

              return (
                <tr key={p.runnerNumber} className={`border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors ${hasNoOdds ? "opacity-40" : ""}`}>
                  <td className="px-3 py-3 font-mono font-bold text-blue-400 whitespace-nowrap">#{p.runnerNumber}</td>
                  <td className="px-3 py-3 font-medium text-white whitespace-nowrap">{p.runnerName}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{currentRating}</td>
                  <td className={`px-3 py-3 whitespace-nowrap ${ratingChange.startsWith('+') ? 'text-red-400' : ratingChange.startsWith('-') ? 'text-emerald-400' : 'text-slate-500'}`}>{ratingChange}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{currentWeight}</td>
                  <td className={`px-3 py-3 whitespace-nowrap ${weightChange.startsWith('+') ? 'text-red-400' : weightChange.startsWith('-') ? 'text-emerald-400' : 'text-slate-500'}`}>{weightChange}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{currentHorseWeight}</td>
                  <td className={`px-3 py-3 whitespace-nowrap ${horseWeightChange.startsWith('+') ? 'text-emerald-400' : horseWeightChange.startsWith('-') ? 'text-red-400' : 'text-slate-500'}`}>{horseWeightChange}</td>
                  <td className="px-3 py-3 text-amber-400/80 font-mono whitespace-nowrap">{cumulativeBurden}</td>
                  <td className={`px-3 py-3 font-mono whitespace-nowrap ${timeDiffVal > 0 ? "text-emerald-400" : timeDiffVal < 0 ? "text-red-400" : "text-slate-500"}`}>{timeDiff}</td>
                  <td className="px-3 py-3 font-mono text-[10px] whitespace-nowrap">{p.last3Form || "—"}</td>
                  <td className="px-3 py-3 text-[11px] text-slate-400 leading-tight min-w-[180px] whitespace-nowrap">{prosCons}</td>
                  <td className="px-3 py-3 font-bold whitespace-nowrap">
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
