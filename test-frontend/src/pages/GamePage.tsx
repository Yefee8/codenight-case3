import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { useAuth } from "../auth/AuthContext";
import { AsyncState } from "../components/AsyncState";
import { useSse } from "../hooks/useSse";
import type { GameProfile, LeaderboardEntry } from "../types";

interface GameEvent { type: string; message: string; badge_name?: string }

export function GamePage() {
  const { api, accessToken, user } = useAuth();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<"daily" | "weekly">("daily");
  const [toast, setToast] = useState("");
  const leaderboard = useQuery({ queryKey: ["leaderboard", period], queryFn: () => api.request<LeaderboardEntry[]>(`/api/v1/game/leaderboard?period=${period}`) });
  const profile = useQuery({ queryKey: ["game", "profile"], queryFn: () => api.request<GameProfile>("/api/v1/game/profile/me"), enabled: user?.role === "ANALYST" });
  const onEvent = useCallback((event: { data: GameEvent }) => {
    setToast(event.data.badge_name ? `Yeni rozet: ${event.data.badge_name}` : event.data.message);
    void queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
    void queryClient.invalidateQueries({ queryKey: ["game"] });
    window.setTimeout(() => setToast(""), 5_000);
  }, [queryClient]);
  useSse<GameEvent>("/api/v1/game/notifications/stream", accessToken, onEvent);

  return (
    <>
      <header className="page-header"><div><p className="eyebrow">Gamification</p><h1>Profil ve liderlik</h1></div>{toast && <div className="toast" role="status">{toast}</div>}</header>
      {user?.role === "ANALYST" && <section className="panel"><AsyncState loading={profile.isLoading} error={profile.error}>{profile.data && <div className="profile-summary"><div className={`level-frame level-${profile.data.level.toLowerCase()}`}><span>{profile.data.level}</span><strong>{profile.data.total_points}</strong><small>toplam puan</small></div><dl className="detail-list"><div><dt>Çözülen vaka</dt><dd>{profile.data.solved_cases}</dd></div><div><dt>Ortalama geri bildirim</dt><dd>{profile.data.average_feedback?.toFixed(1) ?? "N/A"}</dd></div><div><dt>Günlük sıra</dt><dd>{profile.data.daily_rank ?? "—"}</dd></div><div><dt>Haftalık sıra</dt><dd>{profile.data.weekly_rank ?? "—"}</dd></div></dl><div className="badges" aria-label="Kazanılan rozetler">{profile.data.badges.map((badge) => <article key={badge.code}><span>◆</span><strong>{badge.name}</strong><small>{new Date(badge.earned_at).toLocaleDateString("tr-TR")}</small></article>)}</div></div>}</AsyncState></section>}
      <section className="panel"><div className="card-heading"><h2>İlk 10</h2><div className="tabs"><button aria-pressed={period === "daily"} onClick={() => setPeriod("daily")}>Günlük</button><button aria-pressed={period === "weekly"} onClick={() => setPeriod("weekly")}>Haftalık</button></div></div><AsyncState loading={leaderboard.isLoading} error={leaderboard.error} empty={leaderboard.data?.length === 0}><ol className="leaderboard">{leaderboard.data?.map((entry) => <li key={entry.analyst_id}><span className="rank">{entry.rank}</span><div><strong>{entry.name}</strong><small>{entry.level}</small></div><b>{entry.points} puan</b></li>)}</ol></AsyncState></section>
    </>
  );
}

