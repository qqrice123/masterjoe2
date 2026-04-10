import { useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, RaceDetail } from "@/services/api";
import { EVBadge } from "@/shared/EVBadge";
import { GradeBadge } from "@/shared/GradeBadge";

export function RaceView() {
  const [, params] = useRoute<{ venue: string; raceNo: string }>("/race/:venue/:raceNo");
  const venue = params?.venue || "";
  const raceNo = params?.raceNo || "";

  const { data: race, isLoading } = useQuery<RaceDetail>({
    queryKey: ["race", venue, raceNo],
    queryFn: () => api.getRaceDetail(venue, parseInt(raceNo, 10)),
    enabled: !!venue && !!raceNo,
  });

  if (isLoading) return <div className="p-8 text-center">分析中...</div>;
  if (!race) return <div className="p-8 text-center">找不到賽事資料</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold">{race.raceName}</h1>
          <p className="text-gray-500 mt-1">
            R{race.raceNumber} • {race.distance}米 • {race.track} • {race.going} • {race.raceClass}
          </p>
        </div>
        <Badge variant="outline" className="text-sm">
          {race.postTime}
        </Badge>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-600">#</th>
                <th className="px-4 py-3 font-semibold text-gray-600">馬名</th>
                <th className="px-4 py-3 font-semibold text-gray-600">評級</th>
                <th className="px-4 py-3 font-semibold text-gray-600">系統勝率</th>
                <th className="px-4 py-3 font-semibold text-gray-600">即時賠率</th>
                <th className="px-4 py-3 font-semibold text-gray-600">時間差(s)</th>
                <th className="px-4 py-3 font-semibold text-gray-600">EV 值</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {race.predictions?.map((p: any) => (
                <tr key={p.runnerNumber} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-bold">{p.runnerNumber}</td>
                  <td className="px-4 py-3 font-medium">
                    <div>{p.runnerName}</div>
                    <div className="text-xs text-gray-500">{p.jockey} / {p.trainer}</div>
                  </td>
                  <td className="px-4 py-3">
                    <GradeBadge grade={p.grade} />
                  </td>
                  <td className="px-4 py-3">{p.winProbability}%</td>
                  <td className="px-4 py-3">{p.winOdds}</td>
                  <td className="px-4 py-3 text-gray-500">{p.timeAdvantage}</td>
                  <td className="px-4 py-3">
                    <EVBadge ev={p.expectedValue} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}