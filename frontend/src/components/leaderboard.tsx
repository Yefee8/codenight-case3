"use client";

import { Award, CalendarDays, Crown, Medal, Trophy } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/components/ui/primitives";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useGetLeaderboard } from "@/hooks/use-fraudcell";
import { cn } from "@/lib/utils";
import type { GamificationProfile, LeaderboardEntry } from "@/types/domain";

const levelStyle: Record<GamificationProfile["level"], string> = {
  Platin: "border-accent/40 bg-brand-soft text-brand",
  Altın: "border-amber-400/40 bg-amber-400/10 text-amber-600",
  Gümüş: "border-slate-400/40 bg-slate-400/10 text-slate-500",
  Bronz: "border-orange-700/30 bg-orange-700/10 text-orange-700",
};

/** Keeps the ranking interactive while rendering its first frame entirely on the server. */
export function Leaderboard({ initialEntries }: { initialEntries: LeaderboardEntry[] }) {
  const leaderboard = useGetLeaderboard(initialEntries);
  const top = leaderboard.data?.slice(0, 3) ?? [];

  return (
    <>
      <PageHeading eyebrow="FraudCell League" title="Analist liderlik tablosu" description="Hız, doğruluk ve başarılı fraud yakalamalarıyla puanlanan ilk 10 analist." action={<Badge><CalendarDays size={12} className="mr-1" /> Günlük sezon</Badge>} />
      {leaderboard.isLoading ? <Skeleton className="mb-5 h-52" /> : <div className="mb-5 grid gap-4 pt-4 md:grid-cols-3 md:items-stretch md:pt-7">{top.map((entry) => <Podium key={entry.rank} entry={entry} />)}</div>}
      <Card className="shadow-none">
        <CardHeader><div className="flex items-center gap-2"><Trophy size={18} className="text-amber-500" /><CardTitle>Top 10 analist</CardTitle></div><p className="mt-1 text-xs text-muted-foreground">Puanlar her doğrulanmış karardan sonra güncellenir</p></CardHeader>
        <CardContent className="px-0 pb-1">
          {leaderboard.isLoading ? <div className="px-5"><Skeleton className="h-72" /></div> : <Table>
            <TableHeader><TableRow><TableHead className="w-16">Sıra</TableHead><TableHead>Analist</TableHead><TableHead>Seviye</TableHead><TableHead>Rozetler</TableHead><TableHead className="text-right">Puan</TableHead></TableRow></TableHeader>
            <TableBody>{leaderboard.data?.slice(0, 10).map((entry) => <TableRow key={entry.rank} className={entry.rank <= 3 ? "bg-amber-500/[.025]" : ""}><TableCell><Rank rank={entry.rank} /></TableCell><TableCell><div className="flex items-center gap-3"><Avatar name={entry.analyst.full_name} level={entry.profile.level} /><div><strong>{entry.analyst.full_name}</strong><p className="text-[11px] text-muted-foreground">Fraud Analyst</p></div></div></TableCell><TableCell><Badge className={levelStyle[entry.profile.level]}>{entry.profile.level}</Badge></TableCell><TableCell><div className="flex flex-wrap gap-1.5">{entry.profile.badges.map((badge) => <Badge key={badge} className="font-normal"><Award size={11} className="mr-1 text-amber-500" />{badge}</Badge>)}</div></TableCell><TableCell className="text-right text-base font-semibold">{entry.profile.total_points.toLocaleString("tr-TR")}</TableCell></TableRow>)}</TableBody>
          </Table>}
        </CardContent>
      </Card>
    </>
  );
}

function Podium({ entry }: { entry: LeaderboardEntry }) {
  return <div className={cn("h-full", entry.rank === 1 ? "md:order-2 md:-translate-y-4" : entry.rank === 2 ? "md:order-1" : "md:order-3")}>
    <Card className={cn("group relative h-full overflow-visible rounded-xl border-t-4 shadow-none transition-transform duration-200 hover:-translate-y-1 motion-reduce:transform-none motion-reduce:transition-none", entry.rank === 1 ? "border-t-amber-400" : entry.rank === 2 ? "border-t-slate-400" : "border-t-orange-700")}>
      <span className={cn("absolute -top-4 left-1/2 grid size-8 -translate-x-1/2 place-items-center rounded-full border-4 border-background text-xs font-bold", entry.rank === 1 ? "bg-amber-400 text-amber-950" : entry.rank === 2 ? "bg-slate-400 text-slate-950" : "bg-orange-700 text-white")}>{entry.rank}</span>
      <CardContent className="flex flex-col items-center px-5 pb-6 pt-8 text-center">
        <div className="relative mb-3"><Avatar name={entry.analyst.full_name} level={entry.profile.level} large />{entry.rank === 1 && <Crown className="absolute -right-3 -top-4 rotate-12 fill-amber-400 text-amber-500" size={23} />}</div>
        <strong className="max-w-full truncate">{entry.analyst.full_name}</strong>
        <p className="mt-2 text-2xl font-semibold">{entry.profile.total_points.toLocaleString("tr-TR")} <small className="text-xs font-normal text-muted-foreground">puan</small></p>
        <Badge className={cn("mt-3", levelStyle[entry.profile.level])}>{entry.profile.level}</Badge>
      </CardContent>
    </Card>
  </div>;
}

function Rank({ rank }: { rank: number }) {
  if (rank <= 3) return <span className={cn("grid size-7 place-items-center rounded-full", rank === 1 ? "bg-amber-400/15 text-amber-600" : rank === 2 ? "bg-slate-400/15 text-slate-500" : "bg-orange-700/10 text-orange-700")}><Medal size={15} /></span>;
  return <span className="pl-2 font-semibold text-muted-foreground">{rank}</span>;
}

function Avatar({ name, level, large }: { name: string; level: GamificationProfile["level"]; large?: boolean }) {
  return <span className={cn("grid shrink-0 place-items-center rounded-full border-2 bg-muted font-semibold", levelStyle[level], large ? "size-14 text-base" : "size-9 text-xs")}>{name.split(" ").map((part) => part[0]).join("")}</span>;
}
