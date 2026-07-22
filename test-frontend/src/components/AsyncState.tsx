import type { PropsWithChildren, ReactNode } from "react";

interface AsyncStateProps extends PropsWithChildren {
  loading: boolean;
  error: Error | null;
  empty?: boolean;
  emptyMessage?: string;
  retry?: () => void;
  skeleton?: ReactNode;
}

export function AsyncState({
  loading,
  error,
  empty = false,
  emptyMessage = "Henüz gösterilecek kayıt yok.",
  retry,
  skeleton,
  children,
}: AsyncStateProps) {
  if (loading) {
    return <div aria-busy="true">{skeleton ?? <div className="skeleton">Yükleniyor…</div>}</div>;
  }
  if (error) {
    return (
      <div className="alert alert-error" role="alert">
        <strong>İstek tamamlanamadı.</strong>
        <span>{error.message}</span>
        {retry && <button onClick={retry}>Tekrar dene</button>}
      </div>
    );
  }
  if (empty) {
    return <div className="empty-state">{emptyMessage}</div>;
  }
  return <>{children}</>;
}

