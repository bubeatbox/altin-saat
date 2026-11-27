# Altın Saat: inme erken uyarı

İnme (felç) şüphesinde, hastanın yanındaki yakının telefonla yaklaşık bir dakikada yaptığı erken uyarı testi.
Turkcell **Yarının Teknoloji Liderleri 2027** başvurusu için geliştirildi. Tema: Sağlık, Eğitim ve Erişilebilir Yaşam Teknolojileri.

> Uygulama **teşhis koymaz**. Yalnız uyarır ve 112'ye yönlendirir. Test normal çıksa bile "Belirti varsa yine 112'yi ara" der.

## Akış
1. **Kim test ediliyor:** bir yakın ya da kişinin kendisi ("Kendimi test et" modu)
2. **Belirti soruları:** ani güçsüzlük, uyuşma, görme kaybı, denge bozukluğu, şiddetli baş ağrısı
3. **Yüz:** kamera, gülümsemede ağız köşesi asimetrisi (MediaPipe Face Landmarker, telefonda çalışır)
4. **Konuşma:** Türkçe cümle tekrarı; doğruluk, hız, duraklama (Web Speech API, tr-TR)
5. **Kol:** telefon öne uzatılmış kolda, gözler kapalı; kol düşmesi ve içe dönme (ivme ölçer + jiroskop)
6. **Saat:** son normal görülme saati, tedavi penceresinden kalan süre
7. **Sonuç:** 112 butonu, 112'ye söylenecek özet, en yakın inme merkezi, aileye konum mesajı

Ani belirti ya da bariz bulgu çıkarsa uygulama testleri beklemeden 112 ekranını açar. Her test atlanabilir.

## Özgün yönler
- **Kişisel temel kayıt:** kişi sağlıklıyken kendi değerlerini kaydeder; test genel normlarla değil kişinin kendi hâliyle kıyaslanır.
- **Tek telefonla üç ölçüm:** kamera, mikrofon ve hareket sensörleri ek cihaz olmadan aynı akışta.
- **Zaman odaklı yönlendirme:** son normal görülme saati + en yakın inme merkezi + 112 özeti.

## Çalıştırma
Kurulum yok; düz HTML, CSS ve JavaScript (ES modülleri).

```
cd app
python -m http.server 4319
```

Tarayıcıda `http://localhost:4319` açın. Windows'ta `Baslat.cmd` aynısını yapar.
Bilgisayarda kamera ve sensör olmadan denemek için giriş ekranının altındaki **Sunum modu**nu açın.
Telefonda kamera ve sensörler **HTTPS** ister.

## Dosyalar
| Dosya | Görev |
|---|---|
| `app/js/face.js` | Yüz asimetrisi (MediaPipe Face Landmarker) |
| `app/js/speech.js` | Konuşma testi (Web Speech API + WebAudio) |
| `app/js/arm.js` | Kol düşmesi (DeviceOrientation) |
| `app/js/score.js` | Risk düzeyi ve kişisel temel kayıt (yalnız cihazda) |
| `app/js/main.js` | Akış, erken uyarı, 112 ekranı, inme merkezleri, aile mesajı |
| `app/data/inme-merkezleri.json` | Doğrulanmış inme merkezleri (ilk sürüm İzmir) |
| `app/sw.js` | İnternetsiz açılış (service worker) |

## Testler
```
node --test test/                          # birim + kol gürültü testleri
python test/yuz_kalibrasyon_calistir.py    # yüz kalibrasyonu (önce proje kökünde: python -m http.server 4320)
```
Sonuçların özeti: [`test/sonuclar/OZET.md`](test/sonuclar/OZET.md). Bunlar sentetik ve laboratuvar testleridir, klinik doğrulama değildir.
Gönüllü ölçüm rehberi: [`test/GONULLU_REHBERI.md`](test/GONULLU_REHBERI.md).

## Gizlilik
- Kamera görüntüsü ve sensör verisi cihazdan çıkmaz. Sunucu, veritabanı ve kullanıcı hesabı yoktur.
- Kişisel temel kayıt yalnız cihazın yerel depolamasında sayısal değer olarak tutulur; fotoğraf ya da ses saklanmaz.
- Konuşma tanıma tarayıcının yerleşik hizmetini kullanır (Chrome'da Google sunucularında işlenebilir).
- Konum yalnız kullanıcı "aileye gönder" derse mesaja eklenir.

## Geliştirici
Buğra Bayrak, İzmir Kâtip Çelebi Üniversitesi Tıp Fakültesi.
