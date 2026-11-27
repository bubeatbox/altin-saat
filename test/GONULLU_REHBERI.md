# Gönüllü testi: arkadaşlarla eşik ayarı

Amaç: Sağlıklı insanlarda yanlış alarm çıkıyor mu, bilerek yapılan inme taklidi yakalanıyor mu, gerçek telefonlarda ölçmek.
Hedef: en az 15–20 kişi, mümkünse farklı telefonlar (iPhone ve Android).

## Her gönüllü için (yaklaşık 3 dakika)
1. Telefonda Altın Saat'i aç (tünel adresi). Giriş ekranının en altında **Sunum modu**nu aç, "Kapalı" seçili kalsın, **Gönüllü ölçümü**ne dokun.
2. Koduna G01, G02… yaz. İsim yazma.
3. **Normal hâlimle** seçili olsun, **Ölçüme başla**. Yüz, konuşma ve kol testlerini normal yap.
4. Bitince **Yeni ölçüm**, aynı kod, bu kez **İnme taklidi**:
   - Gülümserken **sağ** ağız köşesini kaldırma.
   - Kol testinde **sağ** kolu 10 saniye içinde yavaşça aşağı indir ve avucu içe çevir.
   - Cümleyi yavaş, kekeleyerek, bir iki kelimeyi yutarak söyle.
5. Herkes bitince **Toplanan veriyi gönder**. Dosya WhatsApp ya da BiP ile sana gelir.

Kamera görüntüsü ve ses kaydedilmez. Dosyada yalnızca sayılar ve tekrarlanan sabit cümlenin metni var.
Etik not: Bu bir kullanılabilirlik ve ölçüm denemesi, hastayla yapılmıyor. Hasta verisi için etik kurul gerekir.

## Sonra
Gelen `altinsaat-gonullu-*.json` dosyalarını `altin-saat\test\gonullu\` klasörüne koy ve Claude'a "gönüllü verisi geldi" de.
Analiz: `python test/gonullu_analiz.py` → `test/sonuclar/gonullu-analiz.md` (eşik önerisi, yanlış alarm ve kaçırma oranları).
