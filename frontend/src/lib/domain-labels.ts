import type { FraudType } from "@/types/domain";

export const fraudLabels: Record<FraudType, string> = {
  CALINTI_KART: "Çalıntı Kart",
  HESAP_ELE_GECIRME: "Hesap Ele Geçirme",
  PARA_AKLAMA: "Para Aklama",
  SUPHELI_DAVRANIS: "Şüpheli Davranış",
  TEMIZ: "Temiz",
  BELIRSIZ: "Belirsiz",
};
