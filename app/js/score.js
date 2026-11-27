// Üç ölçümü tek karara çevirir. FAST mantığı: tek bir belirgin bulgu bile 112 için yeterli.
// Bu bir teşhis değildir; amaç kimseyi yanlışlıkla rahatlatmamak.

export const ESIK_YUKSEK = 0.5;
export const ESIK_ORTA = 0.3;

/** riskler: { yuz, kol, konusma } her biri 0..1 ya da null (ölçülemedi) */
export function genelSeviye(riskler) {
  const degerler = Object.values(riskler).filter(v => typeof v === 'number');
  if (!degerler.length) return 'belirsiz';
  const enYuksek = Math.max(...degerler);
  if (enYuksek >= ESIK_YUKSEK) return 'yuksek';
  if (enYuksek >= ESIK_ORTA) return 'orta';
  return 'dusuk';
}

export function bulguDurumu(risk) {
  if (typeof risk !== 'number') return 'belirsiz';
  if (risk >= ESIK_YUKSEK) return 'var';
  if (risk >= ESIK_ORTA) return 'sinirda';
  return 'yok';
}

// --- Kişisel temel kayıtlar (yalnız bu cihazda) ---
const ANAHTAR = 'altinsaat.profiller.v1';

export function profilleriOku() {
  try { return JSON.parse(localStorage.getItem(ANAHTAR)) || {}; } catch { return {}; }
}

export function profilKaydet(ad, temel) {
  try {
    const p = profilleriOku();
    p[ad] = { ...temel, tarih: new Date().toISOString() };
    localStorage.setItem(ANAHTAR, JSON.stringify(p));
    return true;
  } catch { return false; }
}

export function profilSil(ad) {
  try { const p = profilleriOku(); delete p[ad]; localStorage.setItem(ANAHTAR, JSON.stringify(p)); } catch { /* yok say */ }
}
