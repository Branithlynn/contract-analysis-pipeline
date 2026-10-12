import { CircleCheck, CircleX, Clock, Eye, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { DocumentSummary } from "@nexus/shared";
import { statusChip, type ChipKind } from "../lib/statusChip.js";

const ICONS: Record<ChipKind, typeof Clock> = {
  queued: Clock,
  processing: LoaderCircle,
  completed: CircleCheck,
  review: Eye,
  failed: CircleX,
};

// Re-renders once a second, only while something on screen is counting.
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [ticking]);
  return now;
}

// Icon, text and color together: the color is never the only thing that tells two states apart.
export function StatusChip({ doc }: { doc: DocumentSummary }) {
  const now = useNow(doc.status === "processing");
  const chip = statusChip(doc, now);
  const Icon = ICONS[chip.kind];
  return (
    <span className={`chip chip-${chip.kind}`} title={chip.title ?? undefined}>
      <Icon size={14} aria-hidden="true" className={chip.kind === "processing" ? "spin" : ""} />
      <span>{chip.label}</span>
      {chip.detail !== null && <span className="chip-detail">{chip.detail}</span>}
    </span>
  );
}
