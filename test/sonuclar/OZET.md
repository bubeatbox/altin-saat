# Altın Saat: test özeti (21 Kas 2026)

Başvuru formunun "Mevcut gelişim durumu, testler" bölümü için. Hepsi otomatik ve tekrarlanabilir.
**Bunlar sentetik ve laboratuvar testleridir, klinik doğrulama değildir.** Sıradaki adım gönüllü testi.

## 1. Yüz ölçümü: gerçekçi fotoğraflarla kalibrasyon
`python test/yuz_kalibrasyon_calistir.py` (önce proje kökünde `python -m http.server 4320`)
- 4 farklı yüz (45–70 yaş, kadın ve erkek), her biri için düz bakış ve gülümseme fotoğrafı.
- Ağız köşesi yapay olarak göz arası mesafenin %5–30'u kadar düşürüldü; baş eğikliği ±8–15° ve telefon uzaklaşması da denendi.

| Ölçüt | Sonuç |
|---|---|
| Sağlıklı gülümsemede doğru "normal" (baş eğik, uzak dahil) | **28/28** |
| Belirgin düşmede (≥%15) doğru "inme" | **32/32** |
| Bulgu verilenlerde zayıf taraf doğru bulundu | **40/40** |
| Hafif düşmede (%5–10) en az "sınırda" | 8/16 |

Sağlıklı yüzlerde asimetri en çok 0,09 çıktı, alarm eşiği 0,30. Arada geniş bir güvenlik payı var.
Uyarı: Fotoğraflar yapay zekâyla üretildi. Gerçek yüzler daha asimetrik olabilir, eşikler gönüllü verisiyle yeniden ayarlanacak.

## 2. Kol ölçümü: gürültü ve dayanıklılık (her senaryo 200 tekrar, 60 Hz)
`node --test test/`

| Senaryo | Sonuç |
|---|---|
| Sağlıklı kol (titreme ve yavaş kayma), yanlış alarm yok | **200/200** |
| Belirgin güçsüzlük (10–20° düşme ve içe dönme) yakalandı | **200/200** (düzeltme öncesi 191) |
| Hafif güçsüzlük (4–8°) en az "sınırda" | 45/200 (düzeltme öncesi 0) |
| Elin ilk saniyede yerleşmesi, yanlış alarm yok | 200/200 |
| Ortada ani sarsıntı (öksürük), yanlış alarm yok | 200/200 |
| Açının 179°/−179° sınırından geçmesi | 200/200 (hata bulundu ve düzeltildi) |

## 3. Birim testleri
35/35 geçti: Türkçe metin karşılaştırma (İ/ı), konuşma doğruluğu, risk skorları, temel kayıtla taraf kıyası.

## Testlerin bulup düzelttirdiği hatalar
- Telefon açısı ±180° sınırındayken 2°'lik hareket 179° düşme sanılıyordu.
- Hafif kol güçsüzlüğü hiç yakalanmıyordu; eşik ve birleşik skor güncellendi.
