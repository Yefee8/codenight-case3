import { Link } from "react-router-dom";

export function ForbiddenPage() {
  return <main className="center-page"><div className="alert alert-error"><h1>403</h1><p>Bu alan için yetkiniz yok.</p><Link to="/">Güvenli ana sayfaya dön</Link></div></main>;
}

export function NotFoundPage() {
  return <main className="center-page"><div><h1>404</h1><p>Aradığınız sayfa bulunamadı.</p><Link to="/">Ana sayfaya dön</Link></div></main>;
}

