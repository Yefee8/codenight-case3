# ADR-0005 — RS256 JWT ve Refresh Rotation

- Durum: Kabul edildi
- Tarih: 2026-07-22

## Karar

15 dk RS256 access JWT; 7 gün 256-bit opaque refresh token kullanılacak. Refresh DB'de SHA-256
hash, family/session zinciriyle saklanacak ve her kullanımda row-lock altında rotate edilecek.
Reuse bütün kullanıcı session family'lerini revoke edip `session_epoch` artıracak.

## Sonuç

Gateway JWKS'i kısa process cache'te doğrular, revocation epoch'ını Security Redis'ten okur.
Access token browser memory, refresh token `HttpOnly SameSite=Strict Secure` cookie'dir.
local/session storage yasaktır.

