# JWT Rotation, Reuse ve Gateway Zero-Trust Notları

Kısa access JWT her istekte DB session lookup maliyetini azaltır fakat expiry'ye kadar bearer'dır.
Refresh rotation her kullanımda tokenı değiştirir. Eski tokenın tekrar görünmesi client race veya
theft olabilir; güvenli varsayılan family revoke'tur.

Refresh plaintext DB'de tutulmaz; yüksek entropy token hash'i aranır. Row lock iki concurrent
refresh'ten tek kazanan üretir. Rol/profil değişiminde `session_epoch` eski access tokenı expiry
beklemeden reddeder.

Gateway doğrulaması tek güven katmanı değildir. Domain servis tokenı tekrar doğrular ve resource
ownership uygular. Client-supplied identity header temizlenir; internal endpoint ayrı network/
credential kullanır.

Kaynak: [OWASP JWT Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html),
[ADR-0005](../docs/adr/0005-jwt-refresh-rotation.md).

