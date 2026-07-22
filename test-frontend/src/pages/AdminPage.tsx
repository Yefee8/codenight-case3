import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";

import { useAuth } from "../auth/AuthContext";
import { AsyncState } from "../components/AsyncState";
import { StatusBadge } from "../components/StatusBadge";
import type { Page, Role } from "../types";

interface Staff {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: Role;
  status: "ACTIVE" | "LOCKED" | "DISABLED";
  title: string;
  specialties: string[];
  regions: string[];
}

interface AuditLog {
  id: string;
  actor_id: string | null;
  action: string;
  result: string;
  resource_type: string | null;
  resource_id: string | null;
  ip_address_masked: string;
  occurred_at: string;
}

export function AdminPage() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"staff" | "audit">("staff");
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "", password: "", role: "ANALYST" as Role, title: "Fraud Analisti", specialties: "CALINTI_KART", regions: "Marmara" });
  const staff = useQuery({ queryKey: ["admin", "staff"], queryFn: () => api.request<Page<Staff>>("/api/v1/staff?page=0&size=50"), enabled: tab === "staff" });
  const audit = useQuery({ queryKey: ["admin", "audit"], queryFn: () => api.request<Page<AuditLog>>("/api/v1/admin/audit-logs?page=0&size=50"), enabled: tab === "audit" });
  const create = useMutation({
    mutationFn: () => api.request<Staff>("/api/v1/admin/staff", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ ...form, specialties: form.specialties.split(",").map((value) => value.trim()).filter(Boolean), regions: form.regions.split(",").map((value) => value.trim()).filter(Boolean) }) }),
    onSuccess: () => { setForm({ ...form, first_name: "", last_name: "", email: "", password: "" }); void queryClient.invalidateQueries({ queryKey: ["admin", "staff"] }); },
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "DISABLED" }) => api.request(`/api/v1/admin/staff/${id}`, { method: "PATCH", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ status, reason: "Admin hesap yönetimi" }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin", "staff"] }),
  });

  function submit(event: FormEvent) { event.preventDefault(); create.mutate(); }

  return (
    <>
      <header className="page-header"><div><p className="eyebrow">Admin</p><h1>Kimlik ve denetim</h1></div><div className="tabs"><button aria-pressed={tab === "staff"} onClick={() => setTab("staff")}>Personel</button><button aria-pressed={tab === "audit"} onClick={() => setTab("audit")}>Audit log</button></div></header>
      {tab === "staff" ? (
        <>
          <section className="panel"><h2>Personel oluştur</h2><form className="form-grid" onSubmit={submit}><label>Ad<input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required /></label><label>Soyad<input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} required /></label><label>E-posta<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label><label>Geçici şifre<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></label><label>Rol<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}><option>ANALYST</option><option>SUPERVISOR</option><option>ADMIN</option></select></label><label>Unvan<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label><label>Uzmanlıklar (virgül)<input value={form.specialties} onChange={(e) => setForm({ ...form, specialties: e.target.value })} /></label><label>Bölgeler (virgül)<input value={form.regions} onChange={(e) => setForm({ ...form, regions: e.target.value })} /></label><button className="button-primary" disabled={create.isPending}>Hesabı oluştur</button></form>{create.error && <div className="alert alert-error">{create.error.message}</div>}</section>
          <section className="panel"><h2>Personel hesapları</h2><AsyncState loading={staff.isLoading} error={staff.error} retry={() => void staff.refetch()} empty={staff.data?.items.length === 0}><div className="table-wrap"><table><thead><tr><th>Kişi</th><th>Rol</th><th>Profil</th><th>Durum</th><th>İşlem</th></tr></thead><tbody>{staff.data?.items.map((person) => <tr key={person.id}><td><strong>{person.first_name} {person.last_name}</strong><small>{person.email}</small></td><td>{person.role}</td><td><small>{person.specialties.join(", ")}<br />{person.regions.join(", ")}</small></td><td><StatusBadge value={person.status} /></td><td><button onClick={() => setStatus.mutate({ id: person.id, status: person.status === "DISABLED" ? "ACTIVE" : "DISABLED" })}>{person.status === "DISABLED" ? "Etkinleştir" : "Devre dışı"}</button></td></tr>)}</tbody></table></div></AsyncState></section>
        </>
      ) : (
        <section className="panel"><h2>Değiştirilemez audit zinciri</h2><AsyncState loading={audit.isLoading} error={audit.error} retry={() => void audit.refetch()} empty={audit.data?.items.length === 0}><div className="table-wrap"><table><thead><tr><th>Zaman</th><th>Actor</th><th>Eylem</th><th>Kaynak</th><th>Sonuç/IP</th></tr></thead><tbody>{audit.data?.items.map((log) => <tr key={log.id}><td>{new Date(log.occurred_at).toLocaleString("tr-TR")}</td><td>{log.actor_id ?? "ANONYMOUS"}</td><td>{log.action}</td><td>{log.resource_type ?? "—"}/{log.resource_id ?? "—"}</td><td>{log.result}<br /><small>{log.ip_address_masked}</small></td></tr>)}</tbody></table></div></AsyncState></section>
      )}
    </>
  );
}

