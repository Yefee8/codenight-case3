# FraudCell frontend mimarisi

## İstek akışı

```text
Tarayıcı
  -> Next.js sayfası / aynı-origin BFF (`/api/v1/...`)
  -> oturum ve rol kontrolü
  -> `GATEWAY_URL` (`gateway` container'ı)
  -> Identity / Transaction / Gamification servisleri
```

Tarayıcı yalnız Next.js ile konuşur. Böylece backend adresi ve tokenlar client bundle'a girmez, CORS gerekmez ve rol kontrolü UI bileşenlerine bırakılmaz. AI skorlama endpoint'i public değildir; Transaction servisi AI servisini kendi Docker ağı üzerinden çağırır.

## BFF ve render

- Route Handler'lar gelen veriyi doğrular, oturumu kontrol eder ve isteği gateway'e iletir.
- Server Component'ler ilk ekran verisini sunucuda alır; client dashboard'lar bu veriyi TanStack Query `initialData` olarak kullanır.
- Client mutation'ları yalnız aynı-origin `/api/v1/...` yollarını çağırır ve ilgili query cache'ini yeniler.
- `app/loading.tsx` navigation sırasında iskelet gösterir; responsive shell ve PWA manifest/service worker korunur.

## Yanıt sözleşmesi

BFF, UI'ya tek biçimli yanıt döndürür:

```ts
{ success: true, data: value, error: null }
{ success: false, data: null, error: message }
```

Backend hata kodu korunur; erişim tokenı, refresh tokenı ve iç servis hata ayrıntıları tarayıcı JSON'una eklenmez.

## Container sınırı

Next.js 16 `output: "standalone"` üretir. Runtime image yalnız traced server dosyalarını, `public` ve `.next/static` içeriğini taşır. Frontend, gateway health durumundan sonra başlar ve `http://localhost:3000/login` üzerinden healthcheck edilir.

`COOKIE_SECURE=false` yalnız yerel HTTP demosu içindir. HTTPS deployment'ta `COOKIE_SECURE=true` ve rastgele `AUTH_SECRET` zorunludur.
