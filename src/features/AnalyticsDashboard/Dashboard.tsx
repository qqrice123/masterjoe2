import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Calendar, Trophy, ChevronRight, MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, Meeting, Race } from "@/services/api";

export function Dashboard() {
  const { data: meetings, isLoading: meetingsLoading } = useQuery({
    queryKey: ["meetings"],
    queryFn: api.getMeetings,
  });

  const { data: races, isLoading: racesLoading } = useQuery({
    queryKey: ["races"],
    queryFn: api.getRaces,
  });

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">賽事儀表盤</h1>
      
      {meetingsLoading ? (
        <p>載入中...</p>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2">
          {meetings?.map((meeting: any) => (
            <Card key={meeting.id}>
              <CardContent className="p-5 flex justify-between items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-blue-600" />
                    <span className="font-semibold">{meeting.venue}</span>
                    <Badge variant="secondary">{meeting.status}</Badge>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">{meeting.date}</p>
                </div>
                <Link href={`/race/${meeting.venueCode}/1`} className="p-2 hover:bg-gray-100 rounded-full">
                  <ChevronRight className="h-5 w-5" />
                </Link>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {racesLoading ? null : (
        <section className="space-y-4">
          <h2 className="text-xl font-bold">所有賽事</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {races?.map((race: any) => (
              <Link key={race.id} href={`/race/${race.venueCode}/${race.raceNumber}`}>
                <Card className="hover:border-blue-500 transition-colors cursor-pointer h-full">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge>R{race.raceNumber}</Badge>
                      <span className="font-semibold">{race.raceName}</span>
                    </div>
                    <div className="text-sm text-gray-500 flex flex-wrap gap-2">
                      <span>{race.distance} 米</span>
                      <span>{race.course}</span>
                      <span>{race.raceClass}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}