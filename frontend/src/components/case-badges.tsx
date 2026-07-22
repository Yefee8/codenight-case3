import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { CaseStatus, RiskLevel } from "@/types/domain";

const riskStyles: Record<RiskLevel, string> = {
  KRITIK: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  YUKSEK: "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400",
  ORTA: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  DUSUK: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
};

const statusLabels: Record<CaseStatus, string> = {
  YENI: "Yeni",
  ATANDI: "Atandı",
  INCELENIYOR: "İnceleniyor",
  MUSTERI_DOGRULAMA: "Müşteri Doğrulama",
  ONAYLANDI: "Onaylandı",
  BLOKLANDI: "Bloklandı",
  KAPANDI: "Kapandı",
};

/** Central risk colors prevent queue, detail and assignment views from drifting apart. */
export function RiskBadge({ risk }: { risk: RiskLevel }) {
  return <Badge className={riskStyles[risk]}>{risk}</Badge>;
}

export function StatusBadge({ status, className }: { status: CaseStatus; className?: string }) {
  return <Badge className={cn("bg-muted text-muted-foreground", className)}>{statusLabels[status]}</Badge>;
}
