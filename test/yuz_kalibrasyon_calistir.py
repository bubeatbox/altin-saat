"""Yüz kalibrasyon testini Chrome'da çalıştırır, tabloyu basar ve test/sonuclar/ altına yazar.
Önce proje kökünde: python -m http.server 4320
"""
import json, os, sys
from playwright.sync_api import sync_playwright

KOK = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(KOK, 'sonuclar'), exist_ok=True)

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    pg = b.new_page()
    hatalar = []
    pg.on('pageerror', lambda e: hatalar.append(str(e)))
    pg.goto('http://localhost:4320/test/yuz-kalibrasyon.html')
    pg.wait_for_function('window.BITTI === true', timeout=240000)
    satirlar = pg.evaluate('window.SONUC')
    b.close()

if hatalar:
    print('SAYFA HATASI:', hatalar)
json.dump(satirlar, open(os.path.join(KOK, 'sonuclar', 'yuz-kalibrasyon.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

def f(x):
    return '-' if x is None else f'{x:.2f}'

out = ['| Kişi | Koşul | Beklenen | Asimetri | Dinlenme | Risk | Zayıf taraf | Karar |', '|---|---|---|---|---|---|---|---|']
say = {'normal': [0, 0], 'inme': [0, 0], 'hafif': [0, 0], 'taraf': [0, 0]}
for s in satirlar:
    if s.get('yuzYok') or not s.get('ok', True):
        out.append(f"| {s['kisi']} | {s.get('kosul')} | {s.get('beklenen')} | yüz/gülümseme yok | | | | ölçülemedi |")
        continue
    r = s.get('risk')
    karar = 'inme' if r is not None and r >= 0.5 else 'sınırda' if r is not None and r >= 0.3 else 'normal'
    bek = s['beklenen']
    if bek == 'normal':
        say['normal'][1] += 1; say['normal'][0] += karar == 'normal'
    elif bek == 'inme':
        say['inme'][1] += 1; say['inme'][0] += karar == 'inme'
    else:
        say['hafif'][1] += 1; say['hafif'][0] += karar != 'normal'
    if s.get('dogruTaraf') and karar != 'normal':
        say['taraf'][1] += 1; say['taraf'][0] += s.get('zayifTaraf') == s['dogruTaraf']
    out.append(f"| {s['kisi']} | {s['kosul']} | {bek} | {f(s.get('asimetri'))} | {f(s.get('dinlenmeIsaretli'))} | {f(r)} | {s.get('zayifTaraf','')} | {karar} |")

oz = [
    f"- Sağlıklı gülümsemede doğru 'normal' (özgüllük): {say['normal'][0]}/{say['normal'][1]}",
    f"- Belirgin düşmede (≥%15) doğru 'inme' (duyarlılık): {say['inme'][0]}/{say['inme'][1]}",
    f"- Hafif düşmede (%5-10) en az 'sınırda': {say['hafif'][0]}/{say['hafif'][1]}",
    f"- Bulgu verilenlerde zayıf taraf doğru: {say['taraf'][0]}/{say['taraf'][1]}",
]
rapor = '# Yüz kalibrasyon testi\n\n' + '\n'.join(oz) + '\n\n' + '\n'.join(out) + '\n'
open(os.path.join(KOK, 'sonuclar', 'yuz-kalibrasyon.md'), 'w', encoding='utf-8').write(rapor)
sys.stdout.reconfigure(encoding='utf-8')
print(rapor)
