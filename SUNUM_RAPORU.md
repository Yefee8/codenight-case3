# FraudCell Sunum Raporu

Bu rapor mevcut Python FastAPI + Next.js BFF uygulamasının jüri önünde nasıl anlatılacağını, hangi endpointlerin hangi güvenlik katmanlarıyla korunduğunu ve `case.md` gereksinimlerine göre beklenen puan durumunu özetler.

## Son Eklenen Tamamlanmış Madde

Bu turda **kendi eğittiğimiz ML modeli bonusu (+8)** tamamlandı. Önceki turdaki **SSE canlı puan bildirimi (+2)** de korunuyor.

| Aday madde | Durum | Karar |
|---|---|---|
| 9.1 AI veri/model | 1600 satırlık dataset + training script + scikit-learn artifact eklendi | Tamamlandı |
| 11.1 müşteri feedback | Backend, frontend ve E2E zaten var | Korundu |
| 11.2 SLA/customer devamı | Doğrulama ve closure endpointleri var; tam scheduler daha büyük kapsam | Seçilmedi |
| Bonus RabbitMQ | Zaten var | Kanıtlandı |
| Bonus GitHub Actions | Zaten var | Kanıtlandı |
| Bonus SSE | Küçük ve uçtan uca tamamlanabilir | **Eklendi** |
| Bonus özel ML model | Eğitim verisi ve süreç dokümante edildi | **Eklendi** |

ML model kanıtları:

- Dataset: `services/ai-service/data/fraud_transactions.csv`
- Training script: `services/ai-service/ml/train_model.py`
- Artifact: `services/ai-service/ml/fraud_model.joblib`
- Dokümantasyon: `services/ai-service/AI_MODEL.md`
- Model version: `fraudcell-rf-v1`
- Son metrikler: accuracy `0.903125`, macro F1 `0.845107`

SSE kanıtları:

- Backend: `GET /api/v1/game/notifications/stream`
- BFF: `GET /api/v1/game/notifications/stream`
- Frontend: `EventSource` ile `points.changed` dinlenir, `game-profile` ve `leaderboard` queryleri yenilenir.
- E2E: `frontend/scripts/check-workflow.mjs` stream'in ilk eventini doğrular.

```py
@app.get("/api/v1/game/notifications/stream")
async def notification_stream(user: Annotated[dict, Depends(game_user)]):
    async def events():
        last = ""
        while True:
            with SessionLocal() as db:
                current = sse_event("points.changed", profile_data(user["user_id"], db))
            if current != last:
                yield current
                last = current
            else:
                yield ": keep-alive\n\n"
            await asyncio.sleep(3)

    return StreamingResponse(events(), media_type="text/event-stream")
```

```tsx
const source = new EventSource("/api/v1/game/notifications/stream");
source.addEventListener("points.changed", () => {
  void Promise.all([
    queryClient.invalidateQueries({ queryKey: ["game-profile"] }),
    queryClient.invalidateQueries({ queryKey: ["leaderboard"] }),
  ]);
});
```

## Uçtan Uca Demo Akışı

Jüride gösterilecek ana zincir:

1. `customer` Next.js BFF üzerinden login olur.
2. Müşteri yüksek tutarlı/yurt dışı/yeni cihaz işlemi oluşturur.
3. Transaction Service AI servisini çağırır.
4. AI risk skoru, fraud tipi, karar ve reason code döner.
5. Transaction, vaka oluşturur ve manuel inceleme kuyruğuna alır.
6. Supervisor vakayı analiste atar ve gerekirse AI risk seviyesini override eder.
7. Analyst incelemeyi başlatır ve `BLOKLANDI` kararı verir.
8. Transaction Service `transaction.blocked` eventini RabbitMQ'ya basar.
9. Gamification event'i idempotent ledger'a işler ve +10 puan verir.
10. Staff UI SSE ile puan/profil/leaderboard verisini yeniler.
11. Customer tamamlanan vakaya 1-5 yıldız feedback verir.

AI kapatma şovu:

- `docker compose stop ai-service`
- Yeni işlem yine `201` döner.
- Case `prediction_status=UNAVAILABLE`, `fraud_type=BELIRSIZ`, `recommended_decision=INCELEME`, `reason=AI_UNAVAILABLE` olur.
- Transaction, Identity, Gamification ve UI çalışmaya devam eder.

## Backend Yapısı

| Servis | Teknoloji | Sorumluluk | DB |
|---|---|---|---|
| Identity | FastAPI, SQLAlchemy, PostgreSQL | Login, register, JWT, refresh rotation, logout, lockout, audit | `identity-db` |
| Transaction | FastAPI, SQLAlchemy, PostgreSQL | İşlem, case state machine, AI fallback, RLS, karar eventi | `transaction-db` |
| AI | FastAPI, SQLAlchemy, PostgreSQL, scikit-learn | Eğitilmiş modelle risk skoru, fraud tipi, karar, prediction kaydı | `ai-db` |
| Gamification | FastAPI, SQLAlchemy, PostgreSQL, RabbitMQ | Puan ledger, profil, leaderboard, SSE | `gamification-db` |
| Gateway | Nginx | `/api/v1/**` routing, body limit | DB yok |

Servisler DB paylaşmaz. Dış kimlikler string olarak tutulur, çapraz foreign key yoktur. Bu, jüriye "database-per-service" sınırını net gösterir.

## Public Endpoint Matrisi

| Katman | Endpoint | Rol | Amaç |
|---|---|---|---|
| BFF/Gateway | `POST /api/v1/auth/login` | Herkes | Login, HttpOnly cookie üretimi |
| BFF/Gateway | `POST /api/v1/auth/refresh` | Oturum | Refresh rotation |
| BFF/Gateway | `POST /api/v1/auth/logout` | Oturum | Refresh revoke |
| BFF/Gateway | `POST /api/v1/transactions/simulate` | Customer | Demo işlem + case üretimi |
| Gateway | `POST /api/v1/transactions` | Customer | Canonical işlem oluşturma |
| BFF/Gateway | `GET /api/v1/cases` | Customer/Analyst/Supervisor/Admin | Role göre vaka listesi |
| BFF/Gateway | `GET /api/v1/cases/{id}` | Customer/Analyst/Supervisor/Admin | IDOR kontrollü vaka detayı |
| BFF/Gateway | `PATCH /api/v1/cases/{id}/assignment` | Supervisor | Manuel analist atama |
| BFF/Gateway | `PATCH /api/v1/cases/{id}/risk-level` | Supervisor | AI risk seviyesini operasyonel override |
| BFF/Gateway | `POST /api/v1/cases/{id}/actions/start-review` | Analyst | İncelemeyi başlatma |
| BFF/Gateway | `PATCH /api/v1/cases/{id}/decision` | Analyst/Supervisor | Final insan kararı |
| BFF/Gateway | `POST /api/v1/cases/{id}/feedback` | Customer | 1-5 yıldız süreç değerlendirmesi |
| Gateway | `POST /api/v1/ai/score` | Public demo | AI skor endpointi |
| BFF/Gateway | `GET /api/v1/game/leaderboard?period=daily` | Staff | Liderlik tablosu |
| BFF/Gateway | `GET /api/v1/game/profile/{id}` | Staff | Analist profili |
| BFF/Gateway | `GET /api/v1/game/notifications/stream` | Staff | SSE puan bildirimi |

## Frontend Yapısı

Frontend Next.js App Router kullanır:

- `src/app/*/page.tsx`: role özel SSR sayfalar.
- `src/app/api/v1/**/route.ts`: browser-facing BFF endpointleri.
- `src/lib/server/auth.ts`: HttpOnly cookie session yönetimi.
- `src/lib/server/fraud-service.ts`: server-side gateway client.
- `src/hooks/use-fraudcell.ts`: TanStack Query mutation/query hookları.
- `src/components/*-dashboard.tsx`: Customer, Analyst, Supervisor ekranları.

Tasarım sistemi sade ve operasyon ekranına uygun tutuldu:

- Tailwind tokenları `globals.css` içinde CSS variable olarak tanımlı.
- Ana renkler: `--brand`, `--accent`, `--surface`, `--muted`.
- `components/ui/primitives.tsx` buton, input, card, badge gibi ortak parçaları sağlar.
- `case-badges.tsx` risk ve status etiketlerini tek yerden üretir.
- `domain-labels.ts` reason code ve fraud type değerlerini UI cümlelerine çevirir.

Örnek: UI ham `VERY_HIGH_AMOUNT,TRANSFER` göstermez.

```ts
export function formatReasonCodes(value: string) {
  return value
    .split(",")
    .map((code) => reasonLabels[code.trim()] ?? code.trim())
    .join(" ");
}
```

## Güvenlik Önlemleri

### Next.js BFF

BFF, browser'dan gelen her role özel endpointte session rolünü tekrar kontrol eder.

```ts
export async function authorizeApi(allowed: Role[]): Promise<SessionUser | Response> {
  const session = await getSession();
  if (!session) return apiError(401, "Oturum açmanız gerekiyor");
  return allowed.includes(session.role) ? session : apiError(403, "Bu işlem için yetkiniz yok");
}
```

Tokenlar JSON response'a konmaz; BFF access, refresh ve session değerlerini HttpOnly cookie olarak yazar.

```ts
store.set(ACCESS_COOKIE, tokens.access_token, {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
});
store.set(REFRESH_COOKIE, tokens.refresh_token, {
  httpOnly: true,
  sameSite: "strict",
  path: "/api/v1/auth",
});
```

### Python Backend RBAC ve IDOR

Transaction Service hem rol dependency hem nesne sahipliği kontrolü yapar.

```py
def supervisor_user(user: Annotated[dict, Depends(current_user)]) -> dict:
    if user["role"] != "SUPERVISOR":
        raise HTTPException(403, "Bu işlem için SUPERVISOR rolü gerekli")
    return user

def ensure_case_access(case: RiskCase, user: dict) -> None:
    if user["role"] == "CUSTOMER" and case.transaction.customer_id != user["user_id"]:
        raise HTTPException(403, "Bu kayıt başka bir kullanıcıya ait")
    if user["role"] == "ANALYST" and case.assigned_analyst_id != user["user_id"]:
        raise HTTPException(403, "Bu vaka başka bir analiste atanmış")
```

### PostgreSQL RLS

Transaction DB'de `transactions` ve `risk_cases` için RLS aktif ve `FORCE ROW LEVEL SECURITY` ile zorlanır. Session değişkenleri request başında set edilir.

```py
def apply_rls(db: Session, user: dict) -> None:
    if engine.dialect.name == "postgresql":
        db.execute(
            text("select set_config('app.user_id', :user_id, true), set_config('app.role', :role, true)"),
            {"user_id": user["user_id"], "role": user["role"]},
        )
```

RLS policy örneği:

```sql
CREATE POLICY case_read ON risk_cases FOR SELECT USING (
    current_setting('app.role', true) IN ('SUPERVISOR', 'ADMIN')
    OR (current_setting('app.role', true) = 'ANALYST'
        AND assigned_analyst_id = current_setting('app.user_id', true))
    OR (current_setting('app.role', true) = 'CUSTOMER'
        AND EXISTS (
            SELECT 1 FROM transactions
            WHERE transactions.id = risk_cases.transaction_id
            AND transactions.customer_id = current_setting('app.user_id', true)
        ))
)
```

### SQL Injection

Kritik sorgular SQLAlchemy `select()` ve bind parametreleriyle kurulur; kullanıcı girdisi string concat ile SQL'e eklenmez.

```py
user = db.scalar(select(User).where(User.username == normalized))
transaction = db.scalar(
    select(Transaction)
    .options(joinedload(Transaction.case))
    .where(Transaction.id == transaction_id)
)
```

### XSS

Python request modelleri ve Next.js BFF route'ları `<script>` etiketlerini düz metinden temizler.

```py
SCRIPT_RE = re.compile(r"</?script\b[^>]*>", re.IGNORECASE)

def clean_text(value: str | None) -> str | None:
    return SCRIPT_RE.sub("", value).strip() if isinstance(value, str) else value
```

React tarafında `dangerouslySetInnerHTML` kullanılmaz; veriler JSX içinde text olarak render edilir.

### Token Manipülasyonu

Access token imza/expiry/type kontrolünden geçer. Refresh token tek kullanımlık DB kaydıdır; refresh veya logout sonrası eski kayıt `revoked=True` olur.

```py
payload = decode_token(body.refresh_token, "refresh")
stored = db.get(RefreshToken, payload["jti"])
if not stored or stored.revoked or stored.expires_at <= utcnow():
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token geçersiz")
stored.revoked = True
```

### Brute Force

Identity login endpointinde `slowapi` rate limit vardır. Aynı hesap 5 hatalı denemeden sonra DB seviyesinde 15 dakika kilitlenir.

```py
@limiter.limit("20/minute")
def login(request: Request, body: LoginRequest, db: Annotated[Session, Depends(get_db)]):
    ...
    if user:
        user.failed_attempts += 1
        if user.failed_attempts >= MAX_FAILED_ATTEMPTS:
            user.locked_until = now + LOCK_TTL
```

## Test ve Doğrulama

Unit testler:

```bash
docker compose run --rm --no-deps transaction-service pytest test_main.py
docker compose run --rm --no-deps -v "$PWD/services/identity-service:/app" identity-service pytest test_identity.py
python3 -m unittest discover -s services/ai-service -p 'test_*.py'
python3 -m unittest discover -s services/gamification-service -p 'test_*.py'
```

Frontend ve E2E:

```bash
cd frontend
pnpm lint
pnpm build
pnpm check:auth
pnpm check:workflow
pnpm check:pwa
```

Güvenlik smoke testleri:

```bash
node security-idor-test.mjs
node security-unauthorized-test.mjs
node security-token-manipulation-test.mjs
node security-bruteforce-test.mjs
node security-input-hardening-test.mjs
```

GitHub Actions:

- `.github/workflows/unit-tests.yml`
- Her push ve pull request'te backend unit testleri, frontend lint ve build çalışır.

## `case.md` 12. Tabloya Göre Puan Değerlendirmesi

`case.md` içindeki tablo ağırlık vermiyor; bu yüzden puan tahmini mevcut repo kanıtına göre yapılmıştır. Mimari ve kod kalitesi hariç değerlendirildi.

| Alan | Kanıt | Beklenen |
|---|---|---|
| API ve routing | Gateway route matrisi, BFF route handlers, standart JSON envelope | Tam |
| Güvenlik canlı testleri | SQLi, IDOR, unauthorized, JWT tamper/expired, revoked refresh, XSS, brute-force scriptleri | Tam |
| Uçtan uca demo | `check:workflow`: customer işlem, supervisor atama/risk override, analyst karar, RabbitMQ puan, SSE, feedback | Tam |
| Servis bağımsızlığı ve resilience | AI stop fallback var; DB-per-service var | Tam |
| Test/dokümantasyon | Backend unit testleri, frontend build/lint, README/API/SECURITY/OPERATIONS/EVENTS | Tam |
| 11.1 feedback | 1-5 yıldız backend + frontend + E2E | Tam |
| 11.2 SLA/customer | Müşteri doğrulama ve closure endpointleri var; tam scheduler yok | Kısmi |
| 9.1 AI veri/model | 1600 satırlık dataset, tekrar çalıştırılabilir training, RandomForest artifact ve gerçek metrikler var | Tam |
| Bonus RabbitMQ | `transaction.blocked` event + Gamification consumer | +5 |
| Bonus SSE | Yeni `points.changed` stream + UI invalidation | +2 |
| Bonus GitHub Actions | Push/PR workflow | +2 |
| Bonus kategori doğruluğu | Training classification report var; online kategori accuracy dashboard yok | Kısmi/0 |
| Bonus özel model | `fraudcell-rf-v1` scikit-learn artifact + dataset + süreç dokümanı | +8 |

Beklenen skor, mimari ve kod kalitesi hariç:

- Zorunlu kalemler: **yaklaşık 58-62 / 65**
- Bonus: **17 / 20** (`özel ML model +8`, `RabbitMQ +5`, `SSE +2`, `GitHub Actions +2`)
- En büyük puan riski: **11.2 tam SLA scheduler** ve online kategori doğruluğu dashboard'u.

Sunumda güvenli ifade:

> "Zorunlu canlı demo, güvenlik testleri, feedback, RLS ve RabbitMQ akışı hazır. Bonus tarafında eğitilmiş ML model, RabbitMQ, SSE ve GitHub Actions tamam. Tam SLA scheduler ve online kategori doğruluğu dashboard'u üretimleşme kapsamı olarak bırakıldı."

## Jüriye Anlatılacak Kısa Teknik Hikaye

FraudCell'de browser doğrudan mikroservislere gitmez; Next.js BFF aynı-origin güvenli API yüzeyidir. BFF session cookie'yi doğrular, role göre endpointi açar ve gateway'e yalnız güvenilir access token ile çıkar.

Backend tarafında Transaction Service en kritik bounded context'tir. İşlem ve vaka aynı servis DB'sinde tutulur; müşteri kimliği request body'den değil token'dan alınır. AI Service `fraudcell-rf-v1` scikit-learn artifact'ini startup'ta load eder; `risk_score = 1 - P(TEMIZ)` hesabıyla fraud tipi ve karar üretir. AI cevap vermezse Transaction fail etmez, case'i manuel incelemeye alır. Böylece servis kapatma demosunda sistem ayakta kalır.

Vaka kararında nihai otorite AI değil insandır. AI sadece skor ve öneri üretir. Supervisor risk override yapabilir ama ham AI skorunu değiştirmez; override reason ve kim tarafından/ne zaman yapıldığı ayrı metadata olarak saklanır.

Gamification, Transaction DB'ye yazmaz. Sadece RabbitMQ eventini tüketir, event ID ile duplicate'i engeller ve kendi ledger'ına puan yazar. UI puanı SSE ile canlı yeniler.

Güvenlik iki katmandır: BFF route guard ve Python backend guard. Transaction DB'de ayrıca PostgreSQL RLS vardır. Bu yüzden müşteri tokenıyla supervisor endpoint çağırmak, ID değiştirerek başkasının kaydına gitmek veya tokenı bozmak 403/401 ile kesilir.
