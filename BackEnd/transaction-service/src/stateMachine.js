// Case state machine per PDF section 4.2
const STATES = ['YENI', 'ATANDI', 'INCELENIYOR', 'MUSTERI_DOGRULAMA', 'ONAYLANDI', 'BLOKLANDI', 'KAPANDI'];

// map: from -> allowed to states, with actor roles
const TRANSITIONS = {
  YENI: { ATANDI: ['SYSTEM', 'SUPERVISOR'] },
  ATANDI: { INCELENIYOR: ['ANALYST'] },
  INCELENIYOR: {
    MUSTERI_DOGRULAMA: ['ANALYST'],
    ONAYLANDI: ['ANALYST'],
    BLOKLANDI: ['ANALYST']
  },
  MUSTERI_DOGRULAMA: { INCELENIYOR: ['SYSTEM'] },
  ONAYLANDI: { KAPANDI: ['SYSTEM'] },
  BLOKLANDI: { KAPANDI: ['SYSTEM'] },
  KAPANDI: {}
};

function canTransition(from, to, role) {
  const t = TRANSITIONS[from];
  if (!t || !t[to]) return { ok: false, reason: `Geçiş izinli değil: ${from} -> ${to}` };
  if (!t[to].includes(role)) return { ok: false, reason: `Bu rol geçiş yapamaz: ${role}` };
  return { ok: true };
}

module.exports = { STATES, TRANSITIONS, canTransition };
