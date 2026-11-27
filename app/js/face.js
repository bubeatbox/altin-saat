// Yüz testi: gülümsemede iki ağız köşesinin ne kadar eşit kalktığını ölçer.
// MediaPipe Face Landmarker telefonun içinde çalışır; görüntü hiçbir yere gönderilmez.

const MP_SURUM = '0.10.14';
const MP_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_SURUM}`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// Yüz noktası numaraları (MediaPipe 478 nokta)
const GOZ_DIS_SAG = 33, GOZ_DIS_SOL = 263;   // kişinin sağ / sol göz dış köşesi
const AGIZ_SAG = 61, AGIZ_SOL = 291;         // kişinin sağ / sol ağız köşesi

let landmarker = null;
let akis = null;
let oturum = 0;   // kamera her kapatıldığında artar; geç gelen akış kapatılır

export async function hazirla() {
  if (landmarker) return landmarker;
  const vision = await import(`${MP_URL}/vision_bundle.mjs`);
  const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_URL}/wasm`);
  landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
  });
  return landmarker;
}

export async function kamerayiAc(video) {
  // Önceki akış açıksa kapat (tekrar denemede iki kamera akışı kalmasın)
  akis?.getTracks().forEach(t => t.stop());
  akis = null;
  const benim = ++oturum;
  const yeni = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 } },
    audio: false,
  });
  if (benim !== oturum) {   // bu arada ekrandan çıkıldı
    yeni.getTracks().forEach(t => t.stop());
    throw new DOMException('İptal', 'AbortError');
  }
  akis = yeni;
  video.srcObject = akis;
  try { await video.play(); } catch (err) { kamerayiKapat(); throw err; }
}

export function kamerayiKapat() {
  oturum++;
  akis?.getTracks().forEach(t => t.stop());
  akis = null;
}

// Yüzün çerçevedeki yeri: ortada mı, uygun büyüklükte mi, baş düz mü?
// Dönen: { var, tamam, ipucu }
export function yuzKonumu(n) {
  if (!n) return { var: false, tamam: false, ipucu: 'Yüzünü çerçeveye getir' };
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (const p of n) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, gen = x1 - x0;
  const a = n[GOZ_DIS_SAG], b = n[GOZ_DIS_SOL];
  const egim = Math.abs(Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI);
  let ipucu = 'Harika, kıpırdama';
  if (cx < 0.33 || cx > 0.67 || cy < 0.3 || cy > 0.7) ipucu = 'Yüzünü çerçevenin ortasına getir';
  else if (gen < 0.25) ipucu = 'Biraz yaklaş';
  else if (gen > 0.85) ipucu = 'Biraz uzaklaş';
  else if (Math.min(egim, 180 - egim) > 12) ipucu = 'Başını düz tut';
  return { var: true, tamam: ipucu === 'Harika, kıpırdama', ipucu };
}

/** Ölçüm öncesi canlı önizleme. onDurum(yuzKonumu sonucu) her karede çağrılır. Durdurmak için dönen fonksiyonu çağır. */
export function onizle({ video, onDurum }) {
  let calisiyor = true;
  const kare = () => {
    if (!calisiyor) return;
    try {
      if (landmarker && video.readyState >= 2) {
        const s = landmarker.detectForVideo(video, performance.now());
        onDurum(yuzKonumu(s.faceLandmarks?.[0]));
      }
    } catch (err) { console.warn('[AltinSaat] önizleme', err); }
    requestAnimationFrame(kare);
  };
  requestAnimationFrame(kare);
  return () => { calisiyor = false; };
}

// Göz çizgisini yatay kabul edip ağız köşelerinin göz çizgisine dik uzaklığını,
// gözler arası mesafeye bölerek verir. Baş eğikliği ve uzaklık etkisini siler.
// MediaPipe x'i genişliğe, y'yi yüksekliğe göre normalize eder; açılar bozulmasın diye pikselle çalış.
export function koseYukseklikleri(nn, w, h) {
  const n = i => ({ x: nn[i].x * w, y: nn[i].y * h });
  const a = n(GOZ_DIS_SAG), b = n(GOZ_DIS_SOL);
  const ex = b.x - a.x, ey = b.y - a.y;
  const iod = Math.hypot(ex, ey) || 1;
  const ux = ex / iod, uy = ey / iod;           // göz ekseni
  const dik = p => ((p.x - a.x) * -uy + (p.y - a.y) * ux) / iod;
  return { sag: dik(n(AGIZ_SAG)), sol: dik(n(AGIZ_SOL)) };
}

function blend(sonuc, ad) {
  const k = sonuc.faceBlendshapes?.[0]?.categories?.find(c => c.categoryName === ad);
  return k ? k.score : 0;
}

const medyan = d => { if (!d.length) return NaN; const s = [...d].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function ciz(tuval, video, n) {
  const ctx = tuval.getContext('2d');
  tuval.width = video.videoWidth; tuval.height = video.videoHeight;
  ctx.clearRect(0, 0, tuval.width, tuval.height);
  if (!n) return;
  const nokta = (i, renk, r) => { ctx.fillStyle = renk; ctx.beginPath(); ctx.arc(n[i].x * tuval.width, n[i].y * tuval.height, r, 0, 7); ctx.fill(); };
  ctx.strokeStyle = 'rgba(232,163,23,.9)'; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(n[GOZ_DIS_SAG].x * tuval.width, n[GOZ_DIS_SAG].y * tuval.height);
  ctx.lineTo(n[GOZ_DIS_SOL].x * tuval.width, n[GOZ_DIS_SOL].y * tuval.height);
  ctx.stroke();
  [GOZ_DIS_SAG, GOZ_DIS_SOL].forEach(i => nokta(i, '#E8A317', 6));
  [AGIZ_SAG, AGIZ_SOL].forEach(i => nokta(i, '#ffffff', 8));
}

/**
 * İki aşamalı ölçüm: önce düz bakış (notrMs), sonra gülümseme (gulumseMs).
 * opts: { video, tuval, demo, demoProfile: 'normal'|'inme', onAsama(ad), onKare(ilerleme0to1) }
 * Dönen: { ok, kalkisAsimetri, blendAsimetri, asimetri, kareSayisi, mode, reason? }
 */
export async function yuzTesti(opts) {
  const { notrMs = 2000, gulumseMs = 3000 } = opts;
  if (opts.demo) return sunumYuzTesti(opts, notrMs, gulumseMs);

  const lm = await hazirla();
  const notr = { sag: [], sol: [] };
  const gul = { sag: [], sol: [], bSag: [], bSol: [] };
  const toplam = notrMs + gulumseMs;
  const t0 = performance.now();
  let asama = 'notr';
  opts.onAsama?.('notr');

  await new Promise((resolve, reject) => {
    const kare = () => {
     try {
      if (opts.signal?.aborted) return reject(new DOMException('İptal', 'AbortError'));
      const t = performance.now() - t0;
      if (t >= toplam) return resolve();
      if (asama === 'notr' && t >= notrMs) { asama = 'gulumse'; opts.onAsama?.('gulumse'); }
      const v = opts.video;
      if (v.readyState >= 2) {
        const s = lm.detectForVideo(v, performance.now());
        const n = s.faceLandmarks?.[0];
        ciz(opts.tuval, v, n);
        if (n) {
          const k = koseYukseklikleri(n, v.videoWidth || 1, v.videoHeight || 1);
          // Gülümseme aşamasının ilk 700 ms'si geçiş sayılır, atlanır.
          if (asama === 'notr' && t > 400) { notr.sag.push(k.sag); notr.sol.push(k.sol); }
          if (asama === 'gulumse' && t > notrMs + 700) {
            gul.sag.push(k.sag); gul.sol.push(k.sol);
            gul.bSag.push(blend(s, 'mouthSmileRight')); gul.bSol.push(blend(s, 'mouthSmileLeft'));
          }
        }
      }
      opts.onKare?.(t / toplam);
      requestAnimationFrame(kare);
     } catch (err) { reject(err); }
    };
    requestAnimationFrame(kare);
  });

  if (notr.sag.length < 8 || gul.sag.length < 8) {
    return { ok: false, mode: 'kamera', reason: 'Yüz yeterince net görülmedi', kareSayisi: notr.sag.length + gul.sag.length };
  }
  return hesapla(
    { sag: medyan(notr.sag), sol: medyan(notr.sol) },
    { sag: medyan(gul.sag), sol: medyan(gul.sol) },
    { sag: medyan(gul.bSag), sol: medyan(gul.bSol) },
    notr.sag.length + gul.sag.length, 'kamera'
  );
}

export function hesapla(notr, gul, b, kareSayisi, mode) {
  // Köşe kalkışı: düz bakıştan gülümsemeye göz çizgisine ne kadar yaklaştı
  const kSag = Math.max(0, notr.sag - gul.sag);
  const kSol = Math.max(0, notr.sol - gul.sol);
  const kBuyuk = Math.max(kSag, kSol);
  if (kBuyuk < 0.02 && Math.max(b.sag, b.sol) < 0.15) {
    return { ok: false, mode, reason: 'Gülümseme algılanmadı', kareSayisi };
  }
  // İşaretli değerler: artı = kişinin sağ tarafı daha zayıf. Temel kayıtla taraf da kıyaslanır.
  const kalkisIsaretli = (kSol - kSag) / Math.max(kBuyuk, 0.04);
  const bBuyuk = Math.max(b.sag, b.sol);
  const blendAsimetri = bBuyuk > 0.05 ? Math.abs(b.sag - b.sol) / bBuyuk : 0;
  // Blend adlarının taraf yönü belirsiz; büyüklüğünü geometrinin işaretiyle kullan.
  const isaretli = 0.6 * kalkisIsaretli + 0.4 * blendAsimetri * Math.sign(kalkisIsaretli || 1);
  // Dinlenmede köşe sarkması: artı = sağ köşe daha aşağıda (göz çizgisine daha uzak)
  const dinlenmeIsaretli = notr.sag - notr.sol;
  const zayifTaraf = isaretli > 0 ? 'sağ' : 'sol';
  return { ok: true, mode, asimetri: Math.abs(isaretli), isaretli, kalkisAsimetri: Math.abs(kalkisIsaretli), blendAsimetri, dinlenmeIsaretli, zayifTaraf, kareSayisi };
}

function sunumYuzTesti(opts, notrMs, gulumseMs) {
  const inme = opts.demoProfile === 'inme';
  const agiz = document.getElementById('sunumAgiz');
  return new Promise((resolve, reject) => {
    opts.onAsama?.('notr');
    const toplam = notrMs + gulumseMs, t0 = performance.now();
    let gecti = false;
    const kare = () => {
      if (opts.signal?.aborted) { agiz?.setAttribute('d', 'M68 168 Q100 172 132 168'); return reject(new DOMException('İptal', 'AbortError')); }
      const t = performance.now() - t0;
      opts.onKare?.(Math.min(1, t / toplam));
      if (!gecti && t >= notrMs) {
        gecti = true; opts.onAsama?.('gulumse');
        // Sunum yüzünde gülümseme: inme profilinde kişinin sağ tarafı (ekranda sol) kalkmaz
        agiz?.setAttribute('d', inme ? 'M68 172 Q102 190 132 152' : 'M64 156 Q100 196 136 156');
      }
      if (t < toplam) return requestAnimationFrame(kare);
      agiz?.setAttribute('d', 'M68 168 Q100 172 132 168');
      resolve(inme
        ? hesapla({ sag: 0.95, sol: 0.95 }, { sag: 0.93, sol: 0.80 }, { sag: 0.18, sol: 0.71 }, 90, 'demo')
        : hesapla({ sag: 0.95, sol: 0.95 }, { sag: 0.81, sol: 0.80 }, { sag: 0.66, sol: 0.70 }, 90, 'demo'));
    };
    requestAnimationFrame(kare);
  });
}

// 0..1 risk. Temel kayıt varsa kişinin kendi asimetrisi düşülür.
// Gülümseme farkı ya da dinlenmedeki sarkma, hangisi büyükse.
export function yuzRisk(sonuc, temel) {
  if (!sonuc?.ok) return null;
  const kirp = x => Math.min(1, Math.max(0, x));
  const g = Math.abs(sonuc.isaretli - (temel?.isaretli ?? 0));
  const d = Math.abs(sonuc.dinlenmeIsaretli - (temel?.dinlenmeIsaretli ?? 0));
  const gulumseRisk = kirp((g - 0.2) / 0.35);
  const dinlenmeRisk = kirp((d - 0.08) / 0.12);   // gözler arası mesafeye oranla
  return Math.max(gulumseRisk, dinlenmeRisk);
}
