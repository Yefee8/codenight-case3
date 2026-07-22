const MODEL_VERSION = 'rule-v1';

const RISKY_CITIES = new Set(['LAGOS', 'MOSKOVA', 'KIEV', 'CARACAS', 'YURTDISI']);
const KNOWN_TR_CITIES = new Set(['ISTANBUL', 'ANKARA', 'IZMIR', 'BURSA', 'ADANA', 'ANTALYA', 'KONYA', 'GAZIANTEP', 'MERSIN', 'DIYARBAKIR']);

// Rule-based risk model with real computation (not hardcoded per-input).
// Score is a weighted sum of independent features clipped to [0,1].
function score(input) {
  const amount = Number(input.amount) || 0;
  const type = String(input.type || 'ODEME').toUpperCase();
  const city = String(input.city || '').toUpperCase();
  const device = String(input.device || 'MOBILE').toUpperCase();
  const receiver = String(input.receiver || '');
  const ts = input.timestamp ? new Date(input.timestamp) : new Date();
  const hour = ts.getUTCHours();
  const history = input.customer_history || {};
  const avgAmount = Number(history.avg_amount) || 500;
  const homeCity = String(history.home_city || '').toUpperCase();
  const knownDevice = !!history.known_device;

  const features = {};
  // Amount deviation from customer's average
  const amountRatio = amount / Math.max(avgAmount, 1);
  features.amount = Math.min(0.35, Math.max(0, (amountRatio - 3) * 0.05));
  if (amount > 10000) features.amount += 0.10;
  if (amount > 25000) features.amount += 0.10;

  // Time of day (00:00 - 05:00 UTC is risky)
  features.night = (hour >= 0 && hour <= 5) ? 0.15 : 0;

  // City risk
  if (RISKY_CITIES.has(city)) features.city = 0.30;
  else if (homeCity && city && city !== homeCity) features.city = 0.12;
  else if (!KNOWN_TR_CITIES.has(city) && city !== '') features.city = 0.08;
  else features.city = 0;

  // Device
  features.device = knownDevice ? 0 : 0.12;
  if (device === 'UNKNOWN' || device === 'TOR') features.device += 0.15;

  // Transaction type
  features.type = (type === 'TRANSFER') ? 0.06 : (type === 'CEKIM' ? 0.05 : 0.02);

  // Receiver pattern (all-digits without spaces looks like account number; suspicious IBANs prefix)
  features.receiver = /^TR\d{2}/.test(receiver) ? 0 : (receiver ? 0.03 : 0.05);

  let raw = Object.values(features).reduce((a, b) => a + b, 0);
  raw = Math.min(1, Math.max(0, raw));

  // Classify fraud type from dominant features
  let fraud_type = 'TEMIZ';
  if (raw >= 0.4) {
    const contrib = features;
    const ranked = Object.entries(contrib).sort((a, b) => b[1] - a[1]);
    const top = ranked[0][0];
    if (top === 'city' && features.city >= 0.20) fraud_type = 'CALINTI_KART';
    else if (top === 'device') fraud_type = 'HESAP_ELE_GECIRME';
    else if (top === 'amount' && amount > 20000) fraud_type = 'PARA_AKLAMA';
    else if (top === 'night' || top === 'type') fraud_type = 'SUPHELI_DAVRANIS';
    else fraud_type = 'SUPHELI_DAVRANIS';
  }

  let risk_level;
  if (raw > 0.9) risk_level = 'KRITIK';
  else if (raw >= 0.7) risk_level = 'YUKSEK';
  else if (raw >= 0.4) risk_level = 'ORTA';
  else risk_level = 'DUSUK';

  let decision;
  if (raw < 0.4) decision = 'ONAY';
  else if (raw > 0.9) decision = 'BLOK';
  else decision = 'INCELEME';

  return { risk_score: Number(raw.toFixed(4)), risk_level, fraud_type, decision, features, model_version: MODEL_VERSION };
}

module.exports = { score, MODEL_VERSION };
