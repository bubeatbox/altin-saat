"""Gönüllü ölçümlerinden eşik önerisi çıkarır.

Kullanım: telefonlardan gelen altinsaat-gonullu-*.json dosyalarını test/gonullu/ klasörüne koy, sonra:
    python test/gonullu_analiz.py
Çıktı: test/sonuclar/gonullu-analiz.md

Her ölçüt için normal ve taklit dağılımı, şu anki eşiklerle yanlış alarm/yakalama oranı
ve iki grubu en iyi ayıran eşik (Youden J) hesaplanır. Sunum modu kayıtları atlanır.
"""
import glob, json, os, statistics, sys

KOK = os.path.dirname(os.path.abspath(__file__))
sys.stdout.reconfigure(encoding='utf-8')

kayitlar, gorulen = [], set()
for yol in glob.glob(os.path.join(KOK, 'gonullu', '*.json')):
    for k in json.load(open(yol, encoding='utf-8')):
        anahtar = (k.get('kod'), k.get('tarih'))
        if k.get('sunum') or anahtar in gorulen:
            continue
        gorulen.add(anahtar); kayitlar.append(k)

if not kayitlar:
    print('test/gonullu/ klasöründe ölçüm yok. Telefonlardan gelen JSON dosyalarını oraya koy.')
    sys.exit(0)

def deger(k, yol):
    o = k
    for p in yol.split('.'):
        o = o.get(p) if isinstance(o, dict) else None
    return o if isinstance(o, (int, float)) else None

def kol_en(k, alan):
    v = [deger(k, f'kolSol.{alan}'), deger(k, f'kolSag.{alan}')]
    v = [x for x in v if x is not None]
    return max(v) if v else None

OLCUTLER = [
    # ad, değer fonksiyonu, yüksek değer mi riskli
    ('Yüz asimetrisi', lambda k: deger(k, 'yuz.asimetri'), True),
    ('Yüz dinlenme farkı', lambda k: abs(deger(k, 'yuz.dinlenmeIsaretli')) if deger(k, 'yuz.dinlenmeIsaretli') is not None else None, True),
    ('Kol düşme (en kötü kol, °)', lambda k: kol_en(k, 'driftDeg'), True),
    ('Kol içe dönme (en kötü kol, °)', lambda k: kol_en(k, 'rotationDeg'), True),
    ('Konuşma doğruluğu', lambda k: deger(k, 'konusma.accuracy'), False),
    ('Konuşma hızı (kelime/sn)', lambda k: deger(k, 'konusma.wordsPerSec'), False),
    ('Konuşma duraklama oranı', lambda k: deger(k, 'konusma.pauseRatio'), True),
    ('Risk: yüz', lambda k: deger(k, 'risk.yuz'), True),
    ('Risk: kol', lambda k: deger(k, 'risk.kol'), True),
    ('Risk: konuşma', lambda k: deger(k, 'risk.konusma'), True),
]

def yuzdelik(v, q):
    v = sorted(v); i = (len(v) - 1) * q; a = int(i); b = min(a + 1, len(v) - 1)
    return v[a] + (v[b] - v[a]) * (i - a)

def en_iyi_esik(normal, taklit, yuksek_riskli):
    adaylar = sorted(set(normal + taklit)); en = (None, -1, 0, 0)
    for t in adaylar:
        if yuksek_riskli:
            ozg = sum(x < t for x in normal) / len(normal); duy = sum(x >= t for x in taklit) / len(taklit)
        else:
            ozg = sum(x > t for x in normal) / len(normal); duy = sum(x <= t for x in taklit) / len(taklit)
        if ozg + duy - 1 > en[1]:
            en = (t, ozg + duy - 1, ozg, duy)
    return en

f = lambda x: '-' if x is None else f'{x:.2f}'
n_normal = sum(k['etiket'] == 'normal' for k in kayitlar); n_taklit = len(kayitlar) - n_normal
kisiler = len({k['kod'] for k in kayitlar})
satirlar = [f'# Gönüllü analizi\n', f'{kisiler} kişi, {n_normal} normal ve {n_taklit} taklit ölçüm.\n',
            '| Ölçüt | Normal (ort, %95) | Taklit (ort, %5) | Önerilen eşik | Özgüllük | Duyarlılık |', '|---|---|---|---|---|---|']
for ad, fn, yuksek in OLCUTLER:
    nv = [fn(k) for k in kayitlar if k['etiket'] == 'normal' and fn(k) is not None]
    tv = [fn(k) for k in kayitlar if k['etiket'] == 'taklit' and fn(k) is not None]
    if not nv:
        satirlar.append(f'| {ad} | veri yok | | | | |'); continue
    n_txt = f"{f(statistics.mean(nv))}, {f(yuzdelik(nv, 0.95 if yuksek else 0.05))}"
    if not tv:
        satirlar.append(f'| {ad} | {n_txt} | taklit yok | | | |'); continue
    t_txt = f"{f(statistics.mean(tv))}, {f(yuzdelik(tv, 0.05 if yuksek else 0.95))}"
    t, j, ozg, duy = en_iyi_esik(nv, tv, yuksek)
    satirlar.append(f'| {ad} | {n_txt} | {t_txt} | {f(t)} | %{ozg*100:.0f} | %{duy*100:.0f} |')

# Şu anki uygulama kararı: herhangi bir risk ≥ 0,5 → "inme belirtisi"
def karar(k):
    r = [deger(k, f'risk.{a}') for a in ('yuz', 'kol', 'konusma')]
    r = [x for x in r if x is not None]
    return max(r) >= 0.5 if r else None
yanlis_alarm = [k['kod'] for k in kayitlar if k['etiket'] == 'normal' and karar(k)]
kacan = [k['kod'] for k in kayitlar if k['etiket'] == 'taklit' and karar(k) is False]
satirlar += ['', '## Şu anki eşiklerle uygulamanın kararı',
             f'- Normal ölçümlerde yanlış alarm: {len(yanlis_alarm)}/{n_normal} {yanlis_alarm or ""}',
             f'- Taklitte kaçırılan: {len(kacan)}/{n_taklit} {kacan or ""}',
             '', 'Not: Taklit, gerçek inme değildir. Eşikler en az 15-20 kişiyle ve sağlıklı ölçümlerde yanlış alarm olmayacak şekilde seçilmeli.']
rapor = '\n'.join(satirlar) + '\n'
os.makedirs(os.path.join(KOK, 'sonuclar'), exist_ok=True)
open(os.path.join(KOK, 'sonuclar', 'gonullu-analiz.md'), 'w', encoding='utf-8').write(rapor)
print(rapor)
