# FraudCell Frontend

Next.js 16 App Router arayüzü, mikroservislere doğrudan değil aynı origin üzerindeki Route Handler BFF katmanı üzerinden erişir.

## Docker ile çalıştırma

Proje kökünde:

```bash
docker compose up
```

Arayüz `http://localhost:3000`, backend gateway `http://localhost:8080` adresinde açılır. Compose içinde frontend gateway'e `http://gateway` üzerinden bağlanır.

## Yerel geliştirme

Backend çalışırken:

```bash
pnpm install --frozen-lockfile
GATEWAY_URL=http://localhost:8080 AUTH_SECRET=local-only-secret COOKIE_SECURE=false pnpm dev
```

Ardından `http://localhost:3000` adresini açın.

## Ortam değişkenleri

| Değişken | Amaç | Docker varsayılanı |
|---|---|---|
| `GATEWAY_URL` | BFF'nin backend gateway adresi | `http://gateway` |
| `AUTH_SECRET` | Frontend oturum imzası | Yalnız demo için sabit değer |
| `COOKIE_SECURE` | Oturum cookie'sini yalnız HTTPS ile gönderir | Yerel HTTP demosu için `false` |

Gerçek HTTPS ortamında güçlü ve rastgele bir `AUTH_SECRET` verin, `COOKIE_SECURE=true` kullanın. Bu değişkenler sunucu tarafındadır; `NEXT_PUBLIC_` ile tarayıcı paketine eklenmez.

## Kontroller

```bash
pnpm lint
pnpm build
pnpm check:auth
pnpm check:workflow
pnpm check:pwa
```

`check:*` komutları çalışan Compose stack'ine karşı auth, tam karar/RabbitMQ akışı ve PWA dosyalarını doğrular.

Production image, Next.js'in `standalone` çıktısını çalıştırır ve root olmayan `nextjs` kullanıcısını kullanır.
