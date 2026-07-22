import { NavLink, Outlet } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import type { Role } from "../types";

const LINKS: Record<Role, Array<{ to: string; label: string }>> = {
  CUSTOMER: [{ to: "/customer", label: "İşlemlerim" }],
  ANALYST: [
    { to: "/analyst", label: "Vakalarım" },
    { to: "/game", label: "Profil ve liderlik" },
  ],
  SUPERVISOR: [
    { to: "/supervisor", label: "Operasyon" },
    { to: "/game", label: "Liderlik" },
  ],
  ADMIN: [
    { to: "/admin", label: "Personel" },
    { to: "/supervisor", label: "Dashboard" },
  ],
};

export function AppLayout() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="FraudCell ana sayfa">
          <span className="brand-mark">FC</span>
          <span>FraudCell</span>
        </NavLink>
        <nav aria-label="Ana menü">
          {LINKS[user.role].map((link) => (
            <NavLink key={link.to} to={link.to} className={({ isActive }) => (isActive ? "active" : "")}>
              {link.label}
            </NavLink>
          ))}
        </nav>
        <div className="user-menu">
          <span>{user.first_name} {user.last_name}</span>
          <small>{user.role}</small>
          <button className="button-ghost" onClick={() => void logout()}>Çıkış</button>
        </div>
      </header>
      <main className="page"><Outlet /></main>
    </div>
  );
}

