// Altın Saat: ekran akışı. Ölçüm modülleri: face.js (Claude), arm.js ve speech.js (Codex).
// Sıra (NINDS belirtileri + FAST): belirti soruları → yüz → konuşma → kol → saat → sonuç.
// Yüz ve konuşmada telefon aynı yerde kalır; göz kapatılan kol testi en sondadır.
// Bariz bir bulgu çıkınca testlerin sonu beklenmeden uyarı verilir. Her test atlanabilir.
import * as Yuz from './face.js';
import * as Kol from './arm.js';
import * as Ses from './speech.js';
import { genelSeviye, bulguDurumu, profilleriOku, profilKaydet } from './score.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const SIRA = ['belirtiler', 'yuz', 'konusma', 'kol', 'saat', 'sonuc'];
const TEMEL_SIRA = ['yuz', 'konusma', 'kol', 'temel-bitti'];
const GONULLU_SIRA = ['yuz', 'konusma', 'kol', 'gonullu-bitti'];
const BARIZ = 0.7;   // bu risk ve üstü: testin sonunu bekleme, hemen uyar

const durum = {
  sunum: 'kapali',
  kim: 'yakin',             // 'kendim' | 'yakin'
  ses: false,               // sesli yönerge
  profil: null,
  temelMod: false, temelAd: '',
  gonulluMod: false, gonulluKod: '', gonulluEtiket: 'normal',
  belirtiler: new Set(),
  yuz: null, konusma: null, kolSol: null, kolSag: null,
  elle: {}, atlanan: new Set(),
  lkw: null,
  uyarildi: false,          // erken uyarı bu oturumda gösterildi mi
  ekran: 'giris',
};
let iptal = null;
let acikSoru = null;
let onizlemeDur = null;
let ekranOturumu = 0;   // her ekran değişiminde artar; geç biten işler eski ekranı etkilemesin
const IPTAL = Symbol('iptal');

const demo = () => durum.sunum !== 'kapali';
const inmeSunum = () => durum.sunum === 'inme';
// Metin, test edilen kişiye göre: kendim → "sen", yakın → "o"
const T = (kendim, yakin) => (durum.kim === 'kendim' ? kendim : yakin);

$$('input[name="sunum"]').forEach(r => r.addEventListener('change', () => { durum.sunum = r.value; }));

// ---------- Sesli yönerge ----------
function soyle(metin) {
  if (!durum.ses || !('speechSynthesis' in window)) return Promise.resolve();
  return new Promise(bitti => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(metin);
    u.lang = 'tr-TR'; u.rate = 0.95;
    const tr = speechSynthesis.getVoices().find(v => v.lang?.toLowerCase().startsWith('tr'));
    if (tr) u.voice = tr;
    u.onend = u.onerror = () => bitti();
    speechSynthesis.speak(u);
    setTimeout(bitti, 9000);   // bazı tarayıcılarda onend gelmiyor
  });
}
function sesGuncelle() {
  $('#sesDugme').setAttribute('aria-pressed', String(durum.ses));
  $('#sesDugme').textContent = durum.ses ? 'Sesli yönerge açık' : 'Sesli yönerge kapalı';
}
$('#sesDugme').addEventListener('click', () => {
  durum.ses = !durum.ses; sesGuncelle();
  if (!durum.ses) speechSynthesis?.cancel(); else soyle('Sesli yönerge açık.');
});

// ---------- Ekran geçişi ----------
function goster(ad) {
  iptal?.abort(); iptal = null;
  acikSoru?.(); acikSoru = null;
  onizlemeDur?.(); onizlemeDur = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (ad !== 'yuz') Yuz.kamerayiKapat();
  ekranOturumu++;
  durum.ekran = ad;
  $$('.ekran').forEach(e => { e.hidden = e.dataset.ekran !== ad; });
  $('#ustSerit').hidden = !['belirtiler', 'yuz', 'konusma', 'kol', 'saat', 'uyari'].includes(ad);
  ustSaatGuncelle();
  window.scrollTo(0, 0);
  ({ giris: girisHazirla, belirtiler: belirtiHazirla, yuz: yuzHazirla, konusma: konusmaHazirla, kol: kolHazirla, saat: saatHazirla, sonuc: sonucHazirla, hazirla: kurulumHazirla, 'gonullu-giris': gonulluGiris })[ad]?.();
  const baslik = document.querySelector(`[data-ekran="${ad}"] h1`);
  baslik?.setAttribute('tabindex', '-1'); baslik?.focus({ preventScroll: true });
}

function sonraki(simdiki) {
  const sira = durum.gonulluMod ? GONULLU_SIRA : durum.temelMod ? TEMEL_SIRA : SIRA;
  let s = sira[sira.indexOf(simdiki) + 1];
  if (s === 'saat' && durum.lkw) s = 'sonuc';
  return s;
}

// Bir test bitince: bariz bulgu varsa erken uyarı, yoksa sıradaki ekran
function testBitti(adim) {
  if (durum.temelMod || durum.gonulluMod) {
    const s = sonraki(adim);
    if (s === 'temel-bitti') temelKaydet();
    if (s === 'gonullu-bitti') gonulluKaydet();
    return goster(s);
  }
  const r = riskleriHesapla();
  const bariz = !durum.uyarildi && [r.yuz, r.konusma, r.kol].some(v => typeof v === 'number' && v >= BARIZ);
  if (bariz) return uyariGoster(adim, r);
  goster(sonraki(adim));
}

document.addEventListener('click', e => {
  const git = e.target.closest('[data-git]');
  if (git) goster(git.dataset.git);
  const atla = e.target.closest('[data-atla]');
  if (atla) { const a = atla.dataset.atla; durum.atlanan.add(a); testBitti(a); }
});

// ---------- Giriş ----------
function sifirla() {
  Object.assign(durum, { yuz: null, konusma: null, kolSol: null, kolSag: null, elle: {}, lkw: null, uyarildi: false, temelMod: false, gonulluMod: false });
  durum.belirtiler = new Set(); durum.atlanan = new Set();
  kolTaraf = 'sol'; uyaridanSonraKol = false;
  sonKonum = null; konumSozu = null;
}

function girisHazirla() {
  sifirla();
  const profiller = Object.keys(profilleriOku());
  $('#profilSec').hidden = profiller.length === 0;
  $('#profilListesi').innerHTML = '';
  ['Kayıtsız', ...profiller].forEach((ad, i) => {
    const b = document.createElement('button');
    b.className = 'secim';
    b.textContent = ad;
    b.setAttribute('aria-pressed', String((i === 0 && !durum.profil) || ad === durum.profil));
    b.addEventListener('click', () => {
      durum.profil = i === 0 ? null : ad;
      $$('#profilListesi .secim').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    });
    $('#profilListesi').append(b);
  });
}

$$('[data-kim]').forEach(b => b.addEventListener('click', async () => {
  durum.kim = b.dataset.kim;
  durum.ses = false;   // kullanıcı isteği (21 Kas): varsayılan sesli okuma yok, üst şeritten açılabilir
  sesGuncelle();
  // iOS hareket izni yalnız kullanıcı dokunuşu içinde istenebilir: şimdi iste
  if (!demo()) Kol.requestPermission().then(ok => { durum.hareketIzni = ok; });
  goster('belirtiler');
}));

// ---------- Belirti soruları ----------
const BELIRTI_AD = {
  guc: 'tek tarafta güçsüzlük ya da uyuşma', konusma: 'konuşma ya da anlama güçlüğü',
  gorme: 'ani görme kaybı', denge: 'denge kaybı, yürüyememe', bas: 'nedensiz çok şiddetli baş ağrısı',
};

function belirtiHazirla() {
  $$('.belirti').forEach(b => b.setAttribute('aria-pressed', String(durum.belirtiler.has(b.dataset.belirti))));
  belirtiDugmeGuncelle();
  soyle(T('Bunlardan biri aniden başladı mı? Varsa dokun.', ''));
}
function belirtiDugmeGuncelle() {
  $('#belirtiDevam').textContent = durum.belirtiler.size ? 'Devam' : 'Hiçbiri yok, teste geç';
}
$('#belirtiListesi').addEventListener('click', e => {
  const b = e.target.closest('.belirti');
  if (!b) return;
  const k = b.dataset.belirti;
  durum.belirtiler.has(k) ? durum.belirtiler.delete(k) : durum.belirtiler.add(k);
  b.setAttribute('aria-pressed', String(durum.belirtiler.has(k)));
  belirtiDugmeGuncelle();
});
$('#belirtiDevam').addEventListener('click', () => {
  if (durum.belirtiler.size) return uyariGoster('belirtiler');
  goster('yuz');
});

// ---------- Erken uyarı ----------
let uyaridanSonra = 'yuz';
function uyariGoster(adim, r = riskleriHesapla()) {
  durum.uyarildi = true;
  uyaridanSonra = sonraki(adim);
  const nedenler = [...durum.belirtiler].map(k => BELIRTI_AD[k]);
  if (typeof r.yuz === 'number' && r.yuz >= BARIZ) nedenler.push(`yüzün ${durum.yuz?.zayifTaraf ?? 'bir'} tarafında düşme`);
  if (typeof r.konusma === 'number' && r.konusma >= BARIZ) nedenler.push('konuşma bozukluğu');
  if (typeof r.kol === 'number' && r.kol >= BARIZ) nedenler.push('kolda güçsüzlük');
  goster('uyari');
  const metin = `Görülen: ${nedenler.join(', ')}. Hemen 112'yi ara.`;
  $('#uyariNeden').textContent = metin;
  $('#uyariDevam').hidden = uyaridanSonra === 'sonuc' || uyaridanSonra === 'saat';
  navigator.vibrate?.([300, 120, 300]);
  soyle(`İnme belirtisi olabilir. ${T('Hemen 112\'yi ara.', 'Hemen 112\'yi ara.')}`);
}
$('#uyariDevam').addEventListener('click', () => goster(uyaridanSonra));
$('#uyariSonuc').addEventListener('click', () => goster(durum.lkw ? 'sonuc' : 'saat'));

// ---------- Üst şerit saati ----------
function gecenDakika() { return durum.lkw instanceof Date ? Math.max(0, Math.round((Date.now() - durum.lkw) / 60000)) : null; }
function ustSaatGuncelle() {
  const dk = gecenDakika();
  $('#ustSaat').textContent = dk == null ? 'Altın Saat' : `${Math.floor(dk / 60)} sa ${String(dk % 60).padStart(2, '0')} dk geçti`;
}
setInterval(ustSaatGuncelle, 30000);

// ---------- Elle gözlem (sensör/kamera yoksa) ----------
function elleSor(ekran, soru, secenekler) {
  return new Promise(resolve => {
    acikSoru?.();
    const kutu = document.createElement('div');
    kutu.className = 'kart el-soru';
    kutu.innerHTML = '<h2 class="kart-baslik"></h2><div class="secenekler"></div>';
    kutu.querySelector('h2').textContent = soru;
    secenekler.forEach(([yazi, deger]) => {
      const b = document.createElement('button');
      b.className = 'secim-dugme'; b.textContent = yazi;
      b.addEventListener('click', () => { acikSoru = null; kutu.remove(); resolve(deger); });
      kutu.querySelector('.secenekler').append(b);
    });
    const eylem = ekran.querySelector('.alt-eylem');
    const birincil = eylem.querySelector('.birincil');
    if (birincil) birincil.hidden = true;
    ekran.insertBefore(kutu, eylem);
    acikSoru = () => { kutu.remove(); if (birincil) birincil.hidden = false; resolve(IPTAL); };
    soyle(soru);
  });
}

// ---------- Yüz ----------
const yuzEkran = () => $('[data-ekran="yuz"]');
function cerceve(sinif) { const c = $('#cerceveCizgi'); c.classList.toggle('tamam', sinif === 'tamam'); c.classList.toggle('olcuyor', sinif === 'olcuyor'); }

async function yuzHazirla() {
  const kd = $('#kameraDurum'), video = $('#video');
  const benim = ekranOturumu;
  const gecerli = () => benim === ekranOturumu && durum.ekran === 'yuz';
  $('#yuzYonerge').textContent = T('Yüzünü çerçeveye getir.', 'Telefonu yüzüne tut, yüzü çerçeveye girsin.');
  $('#yuzBasla').hidden = true;
  cerceve('');
  $('#sunumYuz').toggleAttribute('hidden', !demo());
  video.hidden = demo();
  soyle(T('Telefonu yüzüne doğru tut. Yüzün çerçeveye girince ölçüm kendiliğinden başlar.', ''));
  if (demo()) {
    kd.textContent = 'Sunum modu: örnek yüz';
    setTimeout(() => { if (durum.ekran === 'yuz') { cerceve('tamam'); yuzOlc(); } }, 1200);
    return;
  }
  try {
    kd.textContent = 'Kamera açılıyor';
    await Yuz.kamerayiAc(video);
    if (!gecerli()) return;
    kd.textContent = 'Yüz tanıma yükleniyor';
    await Yuz.hazirla();
    if (!gecerli()) { Yuz.kamerayiKapat(); return; }
  } catch (err) {
    if (err?.name === 'AbortError' || !gecerli()) return;
    console.warn('[AltinSaat] kamera/model', err);
    kd.textContent = 'Kamera kullanılamadı';
    const cevap = await elleSor(yuzEkran(), T('Aynada gülümse. Ağzının bir tarafı düşük kalıyor mu?', 'Gülümsediğinde ağzının bir tarafı düşük kalıyor mu?'), [['Evet, bir taraf düşük', 1], ['Hayır, iki taraf eşit', 0], ['Emin değilim', 0.4]]);
    if (cevap === IPTAL) return;
    durum.elle.yuz = cevap; durum.yuz = { ok: false, mode: 'elle' };
    return testBitti('yuz');
  }
  // Çerçeve: yüz ortada ve düzgünse 1 sn bekleyip kendiliğinden başlar
  $('#yuzBasla').hidden = false;
  let tamamSince = 0;
  onizlemeDur = Yuz.onizle({
    video,
    onDurum: k => {
      kd.textContent = k.ipucu;
      cerceve(k.tamam ? 'tamam' : '');
      if (!k.tamam) { tamamSince = 0; return; }
      tamamSince ||= performance.now();
      if (performance.now() - tamamSince > 1000) { onizlemeDur?.(); onizlemeDur = null; yuzOlc(); }
    },
  });
}

$('#yuzBasla').addEventListener('click', () => { onizlemeDur?.(); onizlemeDur = null; yuzOlc(); });

async function yuzOlc() {
  const kd = $('#kameraDurum');
  $('#yuzBasla').hidden = true;
  cerceve('olcuyor');
  iptal = new AbortController();
  const sonuc = await Yuz.yuzTesti({
    video: $('#video'), tuval: $('#yuzTuval'), signal: iptal.signal,
    demo: demo(), demoProfile: inmeSunum() ? 'inme' : 'normal',
    onAsama: a => {
      const yazi = a === 'notr' ? T('Düz bak, kıpırdama.', 'Düz baksın, kıpırdamasın.') : T('Şimdi dişlerini göstererek gülümse.', 'Şimdi dişlerini göstererek gülümsesin.');
      $('#yuzYonerge').textContent = yazi;
      kd.textContent = a === 'notr' ? 'Ölçülüyor' : 'Gülümseme ölçülüyor';
      soyle(a === 'notr' ? T('Düz bak.', '') : T('Şimdi gülümse, dişlerini göster.', ''));
    },
  }).catch(err => ({ ok: false, iptal: err?.name === 'AbortError', reason: err.message }));
  if (sonuc.iptal) return;
  if (!sonuc.ok) {
    kd.textContent = sonuc.reason;
    cerceve('');
    const cevap = await elleSor(yuzEkran(), 'Ölçüm olmadı. Ne yapalım?', [['Tekrar dene', 'tekrar'], [T('Gülümseyemiyorum ya da bir taraf düşük', 'Gülümseyemiyor ya da bir taraf düşük'), 1], ['Gözle bakınca iki taraf eşit', 0]]);
    if (cevap === IPTAL) return;
    if (cevap === 'tekrar') return yuzHazirla();
    durum.elle.yuz = cevap; durum.yuz = { ok: false, mode: 'elle' };
    return testBitti('yuz');
  }
  durum.yuz = sonuc;
  Yuz.kamerayiKapat();
  testBitti('yuz');
}

// ---------- Konuşma ----------
let hedefCumle = Ses.CUMLELER[0];
function konusmaHazirla() {
  hedefCumle = Ses.CUMLELER[Math.floor(Math.random() * Ses.CUMLELER.length)];
  $('#hedefCumle').textContent = hedefCumle;
  $('#konusmaYonerge').textContent = T('Bu cümleyi yüksek sesle söyle.', 'Bu cümleyi yüksek sesle tekrarlamasını iste.');
  $('#duyulan').textContent = '';
  $('#sesCubuklari').innerHTML = '<span></span>'.repeat(18);
  const btn = $('#konusmaBasla');
  btn.disabled = false; btn.hidden = false; btn.textContent = 'Dinlemeye başla';
  // Kendi kendine kullanımda dokunmaya gerek yok: yönerge okunur, sonra dinleme başlar
  if (durum.kim === 'kendim') {
    const bekle = durum.ses ? soyle(`Ekrandaki cümleyi yüksek sesle söyle: ${hedefCumle}`) : new Promise(r => setTimeout(r, 1500));
    bekle.then(() => { if (durum.ekran === 'konusma' && !btn.disabled) konusmaOlc(); });
  }
}

$('#konusmaBasla').addEventListener('click', () => { speechSynthesis?.cancel(); konusmaOlc(); });

async function konusmaOlc() {
  const btn = $('#konusmaBasla');
  btn.disabled = true; btn.textContent = 'Dinliyorum';
  const cubuklar = [...$('#sesCubuklari').children];
  const gecmis = new Array(cubuklar.length).fill(0);
  iptal = new AbortController();
  let sonuc;
  try {
    sonuc = await Ses.runSpeechTest({
      target: hedefCumle, demo: demo(), demoProfile: inmeSunum() ? 'bozuk' : 'normal', signal: iptal.signal,
      onLevel: l => { gecmis.shift(); gecmis.push(l); cubuklar.forEach((c, i) => { c.style.height = `${8 + gecmis[i] * 92}%`; }); },
      onPartial: t => { $('#duyulan').textContent = t; },
    });
  } catch (err) {
    if (err.name === 'AbortError') return;
    sonuc = { ok: false, reason: err.message };
  }
  if (!sonuc.ok) {
    const cevap = await elleSor($('[data-ekran="konusma"]'), `${sonuc.reason || 'Ses ölçülemedi'}. Konuşma nasıldı?`, [['Bozuk: peltek, karışık ya da hiç konuşamıyor', 1], ['Normal', 0], ['Tekrar dene', 'tekrar']]);
    if (cevap === IPTAL) return;
    if (cevap === 'tekrar') return konusmaHazirla();
    durum.elle.konusma = cevap; durum.konusma = { ok: false, mode: 'elle' };
  } else {
    durum.konusma = sonuc;
  }
  testBitti('konusma');
}

// ---------- Kol ----------
let kolTaraf = 'sol';
let uyaridanSonraKol = false;   // sol kolda erken uyarı verildiyse dönüşte sağ kolla devam
function kolHazirla() {
  if (uyaridanSonraKol) { uyaridanSonraKol = false; kolTaraf = 'sag'; return kolArayuz(); }
  kolTaraf = 'sol'; kolArayuz();
}
function kolArayuz() {
  const ad = kolTaraf === 'sol' ? 'sol' : 'sağ';
  $('#kolYonerge').textContent = T(`Telefonu ${ad} eline al.`, `Telefonu ${ad} eline ver.`);
  $('#kolAlt').textContent = T('Kolunu öne uzat, avucun yukarı baksın, telefon avucunda düz dursun. Başlata dokun ve gözlerini kapat. 10 saniye sonra telefon ses çıkaracak.',
    'Kolunu öne uzatsın, avucu yukarı baksın, telefon avucunda düz dursun. Başlata dokunun, gözlerini kapatsın. 10 saniye sonra telefon ses çıkaracak.');
  const btn = $('#kolBasla');
  btn.disabled = false; btn.hidden = false;
  btn.textContent = `${ad[0].toUpperCase() + ad.slice(1)} kol için başlat`;
  $('#kolDurum').textContent = '';
  $('#kolSayi').textContent = '10';
  $('#kolHalka').style.strokeDashoffset = '100';
  $('#kabarcik').style.transform = 'translateY(0)';
  soyle(T(`Telefonu ${ad} eline al. Kolunu öne uzat, avucun yukarı. Başlata dokun ve gözlerini kapat.`, ''));
}

// Kol testi bitiş sesi: AudioContext dokunuş içinde açılır, iOS'ta da çalar (titreşim yoksa da duyulur)
let bitisSesCtx = null;
function bitisSesiHazirla() {
  try { bitisSesCtx ||= new (window.AudioContext || window.webkitAudioContext)(); bitisSesCtx.resume(); } catch { bitisSesCtx = null; }
}
function bitisSesi() {
  const ctx = bitisSesCtx; if (!ctx) return;
  [0, 0.25].forEach((t, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = i ? 990 : 660;
    g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.2);
    o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.22);
  });
}

$('#kolBasla').addEventListener('click', async () => {
  const btn = $('#kolBasla');
  btn.disabled = true;
  bitisSesiHazirla();
  let izin = true;
  if (!demo()) izin = Kol.isSupported() && (durum.hareketIzni ?? await Kol.requestPermission());
  iptal = new AbortController();
  $('#kolDurum').textContent = T('Gözlerini kapat, kıpırdama.', 'Gözlerini kapatsın, kıpırdamasın.');
  soyle(T('Gözlerini kapat.', ''));
  // Sunumda inme profili: sağ kol düşer (sol beyin), yüzün sağı ve konuşma ile uyumlu
  const profil = inmeSunum() && kolTaraf === 'sag' ? 'dusme' : 'normal';
  let sonuc;
  if (!izin) sonuc = { ok: false, reason: 'İzin yok' };
  else try {
    sonuc = await Kol.runArmTest({
      side: kolTaraf, durationMs: 10000, demo: demo(), demoProfile: profil, signal: iptal.signal,
      onTick: (p, drift) => {
        $('#kolHalka').style.strokeDashoffset = String(100 - p * 100);
        $('#kolSayi').textContent = String(Math.max(0, Math.ceil(10 - p * 10)));
        $('#kabarcik').style.transform = `translateY(${Math.min(90, (drift || 0) * 6)}px)`;
      },
    });
  } catch (err) {
    if (err.name === 'AbortError') return;
    sonuc = { ok: false, reason: err.message };
  }
  if (izin) { navigator.vibrate?.([200, 80, 200]); bitisSesi(); }

  if (!sonuc.ok) {
    const cevap = await elleSor($('[data-ekran="kol"]'), T('Hareket sensörü çalışmadı. İki kolunu öne uzat: biri aşağı düşüyor mu?', 'Hareket sensörü çalışmadı. İki kolunu öne uzattığında biri aşağı düşüyor mu?'), [['Evet, bir kol düşüyor', 1], ['Hayır, ikisi de sabit', 0], ['Emin değilim', 0.4]]);
    if (cevap === IPTAL) return;
    durum.elle.kol = cevap;
    if (!durum.kolSol?.ok) durum.kolSol = { ok: false, mode: 'elle' };
    durum.kolSag = { ok: false, mode: 'elle' };
    return testBitti('kol');
  }
  if (kolTaraf === 'sol') {
    durum.kolSol = sonuc;
    soyle(T('Tamam, gözlerini aç. Şimdi sağ el.', ''));
    // Sol kolda bariz düşme varsa sağ kolu beklemeden uyar
    const r = riskleriHesapla();
    if (!durum.temelMod && !durum.gonulluMod && !durum.uyarildi && typeof r.kol === 'number' && r.kol >= BARIZ) {
      kolTaraf = 'sag';
      uyaridanSonraKol = true;
      return uyariGoster('konusma', r);   // "devam" kol ekranına döner
    }
    kolTaraf = 'sag'; kolArayuz(); $('#kolDurum').textContent = 'Sol kol tamam.';
  } else {
    durum.kolSag = sonuc;
    soyle(T('Tamam, gözlerini açabilirsin.', ''));
    testBitti('kol');
  }
});

// ---------- Son normal görülme ----------
function saatHazirla() {
  $('#saatBaslik').textContent = T('En son ne zaman tamamen normaldin?', 'Onu en son ne zaman tamamen normal gördün?');
  soyle(T('En son ne zaman tamamen normaldin?', ''));
}
$('#saatSecenek').addEventListener('click', e => {
  const b = e.target.closest('[data-dk]');
  if (!b) return;
  durum.lkw = b.dataset.dk === 'uyku' ? 'bilinmiyor' : new Date(Date.now() - Number(b.dataset.dk) * 60000);
  goster('sonuc');
});
$('#saatElle').addEventListener('change', e => {
  const [s, d] = e.target.value.split(':').map(Number);
  if (Number.isNaN(s)) return;
  const t = new Date(); t.setHours(s, d, 0, 0);
  if (t > new Date()) t.setDate(t.getDate() - 1);
  durum.lkw = t; goster('sonuc');
});

// ---------- Temel kayıt ----------
$('#temelBasla').addEventListener('click', () => {
  const ad = $('#profilAdi').value.trim();
  if (!ad) { $('#profilAdi').focus(); return; }
  sifirla();
  durum.temelMod = true; durum.temelAd = ad;
  durum.kim = $('input[name="temelKim"]:checked')?.value || 'kendim';
  durum.ses = false; sesGuncelle();
  if (!demo()) Kol.requestPermission().then(ok => { durum.hareketIzni = ok; });
  goster('yuz');
});

function temelKaydet() {
  const temel = {};
  if (durum.yuz?.ok) temel.yuz = { isaretli: durum.yuz.isaretli, dinlenmeIsaretli: durum.yuz.dinlenmeIsaretli };
  if (durum.kolSol?.ok && durum.kolSag?.ok) {
    temel.kol = {
      sol: { driftDeg: durum.kolSol.driftDeg, rotationDeg: durum.kolSol.rotationDeg },
      sag: { driftDeg: durum.kolSag.driftDeg, rotationDeg: durum.kolSag.rotationDeg },
    };
  }
  if (durum.konusma?.ok) temel.konusma = { wordsPerSec: durum.konusma.wordsPerSec, pauseRatio: durum.konusma.pauseRatio };
  const tamam = Object.keys(temel).length > 0 && profilKaydet(durum.temelAd, temel);
  $('#temelBittiBaslik').textContent = tamam ? `${durum.temelAd} için kayıt hazır.` : 'Kayıt yapılamadı. Ölçümler tamamlanmadı ya da tarayıcı kayda izin vermedi.';
  durum.temelMod = false;
}

// ---------- Sonuç ----------
function riskleriHesapla() {
  const temel = durum.profil ? profilleriOku()[durum.profil] : null;
  const yuz = durum.yuz?.ok ? Yuz.yuzRisk(durum.yuz, temel?.yuz) : durum.elle.yuz ?? null;
  // Ölçülen kollar ve elle gözlem birlikte: hangisi en kötüyse o (bir bulgu diğerini silmez)
  const kolAdaylar = [
    durum.kolSol?.ok ? Kol.armRisk(durum.kolSol, temel?.kol?.sol) : null,
    durum.kolSag?.ok ? Kol.armRisk(durum.kolSag, temel?.kol?.sag) : null,
    durum.elle.kol ?? null,
  ].filter(v => typeof v === 'number');
  const kol = kolAdaylar.length ? Math.max(...kolAdaylar) : null;
  const konusma = durum.konusma?.ok ? Ses.speechRisk(durum.konusma, temel?.konusma) : durum.elle.konusma ?? null;
  return { yuz, kol, konusma, temelVar: !!temel };
}

const yuzde = x => `%${Math.round(x * 100)}`;

function bulguYaz(r) {
  const liste = [];
  const atlandi = ad => durum.atlanan.has(ad);
  const y = durum.yuz, yd = bulguDurumu(r.yuz);
  liste.push({
    d: yd, kisa: `yüzün ${y?.zayifTaraf ?? 'bir'} tarafında düşme`,
    b: atlandi('yuz') ? 'Yüz: atlandı' : yd === 'var' ? `Yüz: gülümsemede ${y?.zayifTaraf ?? 'bir'} taraf daha az kalkıyor` : yd === 'sinirda' ? 'Yüz: gülümsemede hafif fark var' : yd === 'yok' ? 'Yüz: gülümseme iki tarafta eşit' : 'Yüz: ölçülemedi',
    k: y?.ok ? `Asimetri ${yuzde(y.asimetri)}` : durum.elle.yuz != null ? 'Gözleme göre' : '',
  });
  const k = durum.konusma, sd = bulguDurumu(r.konusma);
  let sesDetay = '';
  if (k?.ok) {
    const parca = [];
    if (k.accuracy != null) parca.push(`doğruluk ${yuzde(k.accuracy)}`);
    parca.push(`saniyede ${k.wordsPerSec.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} kelime`);
    if (k.pauseRatio > 0.2) parca.push('uzun duraklamalar');
    sesDetay = parca.join(', ');
    if (k.transcript) sesDetay += `. Duyulan: "${k.transcript}"`;
  } else if (durum.elle.konusma != null) sesDetay = 'Gözleme göre';
  liste.push({
    d: sd, kisa: 'konuşma bozukluğu',
    b: atlandi('konusma') ? 'Konuşma: atlandı' : sd === 'var' ? 'Konuşma: bozukluk belirtisi' : sd === 'sinirda' ? 'Konuşma: sınırda' : sd === 'yok' ? 'Konuşma: akıcı ve doğru' : 'Konuşma: ölçülemedi',
    k: sesDetay,
  });
  const kd = bulguDurumu(r.kol);
  let kolDetay = '', kolTarafi = '';
  if (durum.kolSol?.ok) {
    const adaylar = [['sol', durum.kolSol], ['sağ', durum.kolSag?.ok ? durum.kolSag : null]].filter(x => x[1]);
    const [ad, z] = adaylar.sort((a, b) => (b[1].driftDeg + b[1].rotationDeg) - (a[1].driftDeg + a[1].rotationDeg))[0];
    kolTarafi = ad;
    kolDetay = `${ad[0].toUpperCase() + ad.slice(1)} kol ${Math.round(z.driftDeg)}° düştü, ${Math.round(z.rotationDeg)}° içe döndü`;
    if (!durum.kolSag?.ok) kolDetay += ' (sağ kol ölçülmedi)';
  } else if (durum.elle.kol != null) kolDetay = 'Gözleme göre';
  liste.push({
    d: kd, kisa: `${kolTarafi || 'bir'} kolda güçsüzlük`,
    b: atlandi('kol') ? 'Kollar: atlandı' : kd === 'var' ? `Kollar: ${kolTarafi || 'bir'} kolda güçsüzlük belirtisi` : kd === 'sinirda' ? 'Kollar: hafif düşme var' : kd === 'yok' ? 'Kollar: ikisi de sabit kaldı' : 'Kollar: ölçülemedi',
    k: kolDetay,
  });
  return liste;
}

function sonucHazirla() {
  const r = riskleriHesapla();
  let seviye = genelSeviye(r);
  if (durum.belirtiler.size) seviye = 'yuksek';   // bildirilen ani belirti tek başına yeterli
  $('#sonucUst').className = 'sonuc-ust ' + ({ yuksek: '', orta: 'orta', dusuk: 'dusuk', belirsiz: 'orta' }[seviye]);
  const metin = {
    yuksek: ['İnme belirtisi olabilir', 'Hemen 112\'yi ara. Belirtiler geçse bile ara. Yiyecek, içecek ya da ilaç verme.'],
    orta: ['Bazı ölçümler sınırda', 'Belirti aniden başladıysa beklemeden 112\'yi ara.'],
    belirsiz: ['Ölçüm tamamlanamadı', 'Ani belirti varsa beklemeden 112\'yi ara.'],
    dusuk: ['Testte belirgin bir fark görülmedi', 'Bu, inme olmadığı anlamına gelmez. Ani güçsüzlük, uyuşma, görme kaybı, denge kaybı ya da çok şiddetli baş ağrısı varsa 112\'yi ara.'],
  }[seviye];
  $('#sonucBaslik').textContent = metin[0];
  $('#sonucAlt').textContent = metin[1];

  const liste = bulguYaz(r);
  const ul = $('#bulgular'); ul.innerHTML = '';
  const ekle = (sinif, b, k) => {
    const li = document.createElement('li'); li.className = sinif;
    li.innerHTML = '<div><b></b><small></small></div>';
    li.querySelector('b').textContent = b; li.querySelector('small').textContent = k;
    ul.append(li);
  };
  [...durum.belirtiler].forEach(kk => ekle('var', `Bildirilen: ${BELIRTI_AD[kk]}`, 'Aniden başladı'));
  liste.forEach(({ d, b, k }) => ekle(d === 'var' ? 'var' : d === 'belirsiz' ? 'belirsiz' : '', b, k));
  if (r.temelVar) ekle('belirsiz', '', `${durum.profil} için sağlıklıyken alınan kayıtla kıyaslandı.`);

  const dk = gecenDakika();
  const saatYazi = durum.lkw instanceof Date
    ? `Son normal görülme saat ${durum.lkw.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}, yaklaşık ${dk} dakika önce.`
    : 'Son normal görülme saati bilinmiyor.';
  const gorulen = [...[...durum.belirtiler].map(kk => BELIRTI_AD[kk]), ...liste.filter(x => x.d === 'var' || x.d === 'sinirda').map(x => x.kisa)];
  const kimYazi = durum.kim === 'kendim' ? 'Kendimde' : 'Yanımdaki kişide';
  $('#soylenecek').textContent = `"${seviye === 'dusuk' ? 'Ani nörolojik belirti için arıyorum.' : `${kimYazi} inme şüphesi var.`} ${saatYazi} ${gorulen.length ? 'Görülen: ' + [...new Set(gorulen)].join(', ') + '.' : ''} Adresim: …" Açık adresini${durum.kim === 'kendim' ? '' : ' ve kişinin yaşını'} da söyle.`;
  if (seviye === 'yuksek') soyle('İnme belirtisi olabilir. Hemen 112\'yi ara.');
  merkezleriGoster();
}

// ---------- İnme merkezleri ----------
const IZMIR_MERKEZ = { lat: 38.4189, lng: 27.1287 };
let sonKonum = null;
let konumSozu = null;
function mesafeKm(a, b) {
  const R = 6371, r = x => x * Math.PI / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function konumAl() {
  return new Promise(resolve => {
    if (demo() || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve(null), { timeout: 7000, maximumAge: 60000 });
  });
}
async function merkezleriGoster() {
  const ul = $('#merkezler');
  ul.innerHTML = '<li class="soluk">Konum alınıyor</li>';
  let merkezler = [];
  try { merkezler = (await (await fetch('data/inme-merkezleri.json')).json()).filter(m => m.dogrulandi); } catch { /* liste yok */ }
  konumSozu = konumAl();
  sonKonum = await konumSozu;
  const ref = sonKonum || IZMIR_MERKEZ;
  ul.innerHTML = '';
  if (!merkezler.length) { ul.innerHTML = '<li class="soluk">Merkez listesi yüklenemedi. 112 seni doğru hastaneye yönlendirir.</li>'; return; }
  merkezler.map(m => ({ ...m, km: mesafeKm(ref, m) })).sort((a, b) => a.km - b.km).slice(0, 3).forEach(m => {
    const li = document.createElement('li'), a = document.createElement('a');
    a.href = `https://www.google.com/maps/dir/?api=1&destination=${m.lat},${m.lng}`;
    a.target = '_blank'; a.rel = 'noopener';
    a.innerHTML = '<span><b></b><small></small></span><span></span>';
    a.querySelector('b').textContent = m.ad;
    a.querySelector('small').textContent = [m.ilce, m.tur].filter(Boolean).join(', ');
    a.lastElementChild.textContent = `${m.km.toFixed(1)} km`;
    li.append(a); ul.append(li);
  });
  if (!sonKonum) {
    const li = document.createElement('li'); li.className = 'soluk';
    li.textContent = demo() ? 'Sunum modu: İzmir merkezine göre sıralandı.' : 'Konum alınamadı; İzmir merkezine göre sıralandı.';
    ul.append(li);
  }
}

$('#aileyeGonder').addEventListener('click', async () => {
  if (konumSozu && !sonKonum) sonKonum = await konumSozu;
  const konum = sonKonum ? `https://maps.google.com/?q=${sonKonum.lat},${sonKonum.lng}` : '';
  const dk = gecenDakika();
  const kimde = durum.kim === 'kendim' ? 'Bende' : 'Yanımdaki kişide';
  const metin = `Acil: ${kimde} inme şüphesi var. 112 aranmadıysa hemen sen ara.${dk != null ? ` Son normal görülme yaklaşık ${dk} dakika önce.` : ''}${konum ? ` Konum: ${konum}` : ''}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Altın Saat', text: metin });
    else location.href = `sms:?&body=${encodeURIComponent(metin)}`;
  } catch { /* kullanıcı vazgeçti */ }
});

// ---------- Ana ekrana ekleme (PWA) ----------
let kurulumOlayi = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); kurulumOlayi = e; });
function kurulumHazirla() {
  const yuklu = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  $('#kurTamam').hidden = !yuklu;
  $('#kurDugme').hidden = yuklu || !kurulumOlayi;
  $('#kurIos').hidden = yuklu || !ios;
  $('#kurAndroid').hidden = yuklu || ios || !!kurulumOlayi;
}
$('#kurDugme').addEventListener('click', async () => {
  if (!kurulumOlayi) return;
  kurulumOlayi.prompt();
  await kurulumOlayi.userChoice.catch(() => null);
  kurulumOlayi = null; kurulumHazirla();
});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('[AltinSaat] sw', err));
}

// ---------- Gönüllü ölçümü (eşik kalibrasyonu için) ----------
// Görüntü/ses saklanmaz; yalnız ölçülen sayılar. Kod ile anonim.
const GONULLU_ANAHTAR = 'altinsaat.gonullu.v1';
function gonulluOku() { try { return JSON.parse(localStorage.getItem(GONULLU_ANAHTAR)) || []; } catch { return []; } }
function gonulluGiris() {
  const n = gonulluOku().length;
  $('#gonulluSayi').textContent = n ? `Bu telefonda ${n} ölçüm var.` : 'Henüz ölçüm yok.';
  $('#gonulluIndir').hidden = !n; $('#gonulluSil').hidden = !n;
}
$('#gonulluBasla').addEventListener('click', () => {
  const kod = $('#gonulluKod').value.trim().toLocaleUpperCase('tr-TR');
  if (!kod) { $('#gonulluKod').focus(); return; }
  sifirla();
  Object.assign(durum, { gonulluMod: true, gonulluKod: kod, gonulluEtiket: $('input[name="gonulluEtiket"]:checked')?.value || 'normal', kim: 'kendim', ses: false });
  sesGuncelle();
  if (!demo()) Kol.requestPermission().then(ok => { durum.hareketIzni = ok; });
  goster('yuz');
});
const secAlan = (o, alanlar) => (o?.ok ? Object.fromEntries(alanlar.map(a => [a, o[a]])) : (o ? { ok: false, mode: o.mode ?? null } : null));
function gonulluKaydet() {
  const r = riskleriHesapla();
  const kayit = {
    kod: durum.gonulluKod, etiket: durum.gonulluEtiket, tarih: new Date().toISOString(),
    cihaz: (navigator.userAgent.match(/\(([^)]*)\)/)?.[1] || '').slice(0, 80), sunum: demo(),
    yuz: secAlan(durum.yuz, ['asimetri', 'isaretli', 'dinlenmeIsaretli', 'kalkisAsimetri', 'blendAsimetri', 'zayifTaraf', 'kareSayisi']),
    konusma: secAlan(durum.konusma, ['accuracy', 'wordsPerSec', 'pauseRatio', 'durationMs', 'transcript', 'target']),
    kolSol: secAlan(durum.kolSol, ['driftDeg', 'rotationDeg', 'tremorDeg', 'samples']),
    kolSag: secAlan(durum.kolSag, ['driftDeg', 'rotationDeg', 'tremorDeg', 'samples']),
    atlanan: [...durum.atlanan], risk: { yuz: r.yuz, konusma: r.konusma, kol: r.kol },
  };
  const liste = gonulluOku(); liste.push(kayit);
  try { localStorage.setItem(GONULLU_ANAHTAR, JSON.stringify(liste)); } catch { /* depolama dolu */ }
  durum.gonulluMod = false;
  const ul = $('#gonulluOzet'); ul.innerHTML = '';
  const f = x => (typeof x === 'number' ? x.toFixed(2) : '-');
  const kolYazi = kayit.kolSol?.driftDeg != null
    ? `sol ${f(kayit.kolSol.driftDeg)}°/${f(kayit.kolSol.rotationDeg)}°, sağ ${kayit.kolSag?.driftDeg != null ? `${f(kayit.kolSag.driftDeg)}°/${f(kayit.kolSag.rotationDeg)}°` : '-'}, risk ${f(r.kol)}`
    : 'ölçülmedi';
  [[`${kayit.kod}, ${kayit.etiket === 'taklit' ? 'inme taklidi' : 'normal'}`, `Bu telefonda toplam ${liste.length} ölçüm`],
    ['Yüz', kayit.yuz?.asimetri != null ? `asimetri ${f(kayit.yuz.asimetri)}, risk ${f(r.yuz)}` : 'ölçülmedi'],
    ['Konuşma', kayit.konusma?.wordsPerSec != null ? `doğruluk ${f(kayit.konusma.accuracy)}, ${f(kayit.konusma.wordsPerSec)} kelime/sn, risk ${f(r.konusma)}` : 'ölçülmedi'],
    ['Kol', kolYazi],
  ].forEach(([b, k]) => {
    const li = document.createElement('li'); li.className = 'belirsiz';
    li.innerHTML = '<div><b></b><small></small></div>';
    li.querySelector('b').textContent = b; li.querySelector('small').textContent = k; ul.append(li);
  });
}
async function gonulluGonder() {
  const veri = JSON.stringify(gonulluOku(), null, 1);
  const ad = `altinsaat-gonullu-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  const dosya = new File([veri], ad, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [dosya] })) { await navigator.share({ files: [dosya], title: 'Altın Saat gönüllü verisi' }); return; }
  } catch (err) { if (err?.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(dosya); a.download = ad; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
$('#gonulluIndir').addEventListener('click', gonulluGonder);
$('#gonulluIndir2').addEventListener('click', gonulluGonder);
$('#gonulluSil').addEventListener('click', () => {
  const b = $('#gonulluSil');
  if (b.dataset.onay !== '1') { b.dataset.onay = '1'; b.textContent = 'Emin misin? Silmek için tekrar dokun'; return; }
  try { localStorage.removeItem(GONULLU_ANAHTAR); } catch { /* yok say */ }
  b.dataset.onay = ''; b.textContent = 'Bu telefondaki ölçümleri sil';
  gonulluGiris();
});

goster('giris');
