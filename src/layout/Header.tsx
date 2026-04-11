import { Link } from "wouter";
import { Zap } from "lucide-react";

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-white/95 backdrop-blur">
      <div className="container flex h-14 items-center">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg px-4">
          <Zap className="h-5 w-5 text-blue-600" />
          <span>馬靈靈</span>
        </Link>
      </div>
    </header>
  );
}