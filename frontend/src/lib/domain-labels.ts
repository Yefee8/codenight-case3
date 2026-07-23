import type { FraudType } from "@/types/domain";

export const fraudLabels: Record<FraudType | "BELIRSIZ", string> = {
  CALINTI_KART: "Çalıntı Kart",
  HESAP_ELE_GECIRME: "Hesap Ele Geçirme",
  PARA_AKLAMA: "Para Aklama",
  SUPHELI_DAVRANIS: "Şüpheli Davranış",
  TEMIZ: "Temiz",
  BELIRSIZ: "Belirsiz",
};

const reasonLabels: Record<string, string> = {
  VERY_HIGH_AMOUNT: "Tutar olağan işlem limitlerinin çok üzerinde.",
  HIGH_AMOUNT: "Tutar normal işlem aralığının üzerinde.",
  ELEVATED_AMOUNT: "Tutar dikkat gerektiren seviyede.",
  TRANSFER: "Transfer işlemi ek kontrol gerektiriyor.",
  CASH_WITHDRAWAL: "Nakit çekim davranışı risk sinyali taşıyor.",
  FOREIGN_LOCATION: "İşlem alışılmış konum dışında görünüyor.",
  NEW_DEVICE: "İşlem yeni veya tanınmayan bir cihazdan geldi.",
  NEW_RECIPIENT: "Alıcı müşteri geçmişinde yeni görünüyor.",
  UNUSUAL_HOUR: "İşlem alışılmış saatlerin dışında yapıldı.",
  NORMAL_PATTERN: "Belirgin anomali bulunmadı.",
  RULE_BASED: "Kural bazlı risk değerlendirmesi tamamlandı.",
  AI_UNAVAILABLE: "AI servisine ulaşılamadığı için manuel inceleme kuyruğu açıldı.",
};

export function formatReasonCodes(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((code) => reasonLabels[code] ?? code.toLowerCase().replaceAll("_", " "))
    .join(" ");
}
