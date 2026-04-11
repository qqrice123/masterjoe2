import { Badge } from "@/components/ui/badge";

export function EVBadge({ ev }: { ev: number | undefined | null }) {
  if (ev === undefined || ev === null || isNaN(ev)) {
    return <Badge className="bg-[#6b7280] hover:bg-[#4b5563] text-white">—</Badge>;
  }
  if (ev > 0.10) {
    return <Badge className="bg-[#10b981] hover:bg-[#059669] text-white">+{ev.toFixed(3)}</Badge>; // strong_value
  }
  if (ev > 0) {
    return <Badge className="bg-[#f59e0b] hover:bg-[#d97706] text-white">+{ev.toFixed(3)}</Badge>; // marginal_value
  }
  if (ev > -0.15) {
    return <Badge className="bg-[#6b7280] hover:bg-[#4b5563] text-white">{ev.toFixed(3)}</Badge>; // fair
  }
  return <Badge className="bg-[#ef4444] hover:bg-[#dc2626] text-white">{ev.toFixed(3)}</Badge>; // overbet
}
