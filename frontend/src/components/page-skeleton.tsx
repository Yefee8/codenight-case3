import { Card, CardContent, Skeleton } from "@/components/ui/primitives";

/** Mirrors dashboard geometry so route transitions feel immediate without layout shift. */
export function PageSkeleton() {
  return <div aria-label="Sayfa yükleniyor" aria-busy="true">
    <div className="mb-7 space-y-3"><Skeleton className="h-3 w-36" /><Skeleton className="h-9 w-80 max-w-full" /><Skeleton className="h-4 w-[34rem] max-w-full" /></div>
    <div className="mb-5 grid gap-3 sm:grid-cols-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
    <div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]"><Card><CardContent className="space-y-3 py-6"><Skeleton className="h-7 w-44" />{[1, 2, 3, 4, 5].map((row) => <Skeleton key={row} className="h-12 w-full" />)}</CardContent></Card><Card><CardContent className="space-y-4 py-6"><Skeleton className="h-7 w-36" /><Skeleton className="h-28 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-10 w-full" /></CardContent></Card></div>
  </div>;
}

function SkeletonCard() {
  return <Card><CardContent className="flex items-center gap-3 py-4"><Skeleton className="size-10" /><div className="flex-1 space-y-2"><Skeleton className="h-6 w-20" /><Skeleton className="h-3 w-28" /></div></CardContent></Card>;
}
