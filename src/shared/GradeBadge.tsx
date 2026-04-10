import { Badge } from "@/components/ui/badge";

export function GradeBadge({ grade }: { grade: string }) {
  if (grade === "A") {
    return <Badge className="bg-purple-600 hover:bg-purple-700 text-white">A</Badge>;
  }
  if (grade === "B") {
    return <Badge className="bg-blue-500 hover:bg-blue-600 text-white">B</Badge>;
  }
  if (grade === "C") {
    return <Badge className="bg-gray-400 hover:bg-gray-500 text-white">C</Badge>;
  }
  return <Badge className="bg-gray-200 hover:bg-gray-300 text-gray-600">D</Badge>;
}
