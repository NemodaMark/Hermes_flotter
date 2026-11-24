# HERMES teljesítmény- és tesztaudit

**Dátum** 2026. november 24. Az audit alapállapota `985f0a0`. A teszt saját helyi PostgreSQL 18.6 adatbázison és elkülönített Release API-n futott, 30 fiktív járművel, 3 telephellyel, 5 partnerrel, 10 demófiókkal és 8 mintafoglalással.

## Modulok és ellenőrzések

| Terület | Ellenőrzött folyamatok |
| --- | --- |
| Bejelentkezés és fiókbiztonság | Helyi belépés, meghívásos és jogosult regisztráció, munkamenet, jelszócsere és visszaállítás, email-küldés tesztszolgáltatóval, Entra- és proxy-integráció kontrollált válaszokkal |
| Cégek, telephelyek, felhasználók, jogosultságok | Cég- és telephelyadatok, archiválás, munkaterületváltás, hozzáférés-összesítés, profil és profilkép, közös csoportok, delegálás, jogosultság-visszavonás, cégek és telephelyek közötti hozzáférésvédelem, naplózás |
| Járművek, partneradatok, előzmények | Keresés, szűrés és lapozás, régi rendszámok, járműadatlap, modelljavaslatok, lízing, szerviz, használó-hozzárendelés, átadás-átvétel, képek és dokumentumok, előnézet, archiválás és napló |
| Foglalás, tankolás, km és elszámolás | Egyhetes limit, átfedések, telephelyjogok, naptár és lemondás, kilométer- és magánhasználati elszámolás, fogyasztás, bizonylatok, pénzügyi elszámolás, számítás, jóváhagyás és export |
| Kezdőlap és 3D | Áttekintő és saját jármű, dashboardprioritás, modulok mozgatása és méretezése, diagramok, modell- és színválasztás, látható hotspotok, kamera, parkoló és mobilos menük |
| Adatbevitel és adatbázis | CSV és csatolmányok, jogosultsági szűrés, PostgreSQL-sémamigrációk és korábbi adatok megőrzése |
| Asztali indító és telepítés | A Control Center automatizált vezérlési és health check tesztjei, mindkét .NET indító Release buildje, telepítési és mentési szkriptek statikus ellenőrzése |

A teljes futásban 234 backend-, 229 frontend- és 16 Control Center-teszt ment át. A végső forráskódon újrafuttatott 18 célzott backendteszt is átment. A megerősített foglalási teszt 15 párhuzamos próbálkozásból pontosan egy mentést és 14 üzleti ütközést vár, majd a naptárban is ellenőrzi az egyetlen rekordot. A frontend lint, mindkét .NET indító Release buildje, a Vite build és 11 shellszkript szintaxis- és ShellCheck-ellenőrzése sikeres volt. [Backendtesztek](../backend/tests/Hermes.Api.Tests/) · [Frontendtesztek](../frontend/src/) · [Control Center-tesztek](../desktop/tests/Hermes.ControlCenter.Tests/)

A Windowsos demótelepítőt új projektmappában is végigfuttattam. A demóadatok, az indítóparancsikon, a health check, az ismételt telepítés és a meglévő adatokat védő ellenőrzés egyaránt átment. [Windows telepítőteszt](../scripts/tests/workstation-windows-demo.ps1)

## API-terhelés

A teszt hat külön demófiókot használt. A párhuzamos szálak kb. ötöde flottakezelői, a többi diszpécseri vagy telephelyre korlátozott nézettel dolgozott. A terhelés az API által kiszolgált, hitelesített olvasásokra vonatkozik. Minden futást jogosultság-ellenőrzés és bemelegítés előzött meg. A 450 ms szünettel futó szakasz is gyorsabb használatot modellez, mint egy emberi kattintássorozat. A szünet nélküli szakaszok az egyidejű kiszolgálás határát vizsgálják. A p95 azt az időt jelöli, amelyen belül a válaszok 95%-a megérkezett.

### Végső mérés

| Párhuzamos munkamenet | Szünet kérésenként | Kérések | Kérés/mp | p95 | p99 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0 ms | 413 | 51,6 | 28 ms | 32 ms |
| 15 | 450 ms | 255 | 30,4 | 145 ms | 337 ms |
| 15 | 0 ms | 1 061 | 131,0 | 153 ms | 159 ms |
| 30 | 0 ms | 1 064 | 129,1 | 314 ms | 400 ms |
| 60 | 0 ms | 989 | 117,4 | 725 ms | 960 ms |

Mind a 3 782 kérés HTTP 200 választ kapott. A szakaszok nyolc másodpercig indítottak új kéréseket, utána megvárták a már elindítottakat. A táblázat helyi, rövid terhelést mutat, hat bejelentkezett identitás ismételt használatával. Az 50–70 aktív felhasználós célhoz a 15 párhuzamos szál a releváns mérés. A 30 és 60 folyamatosan kérő szálnál már nő a sorban állás.

Az elkülönített API-t és a PostgreSQL-folyamatokat két logikai processzorra korlátozva újrafuttattam a tesztet. A 15 szálas, szünetes szakaszban a p95 144 ms, a p99 455 ms volt. A 60 szálas, folyamatos szakaszban a p95 785 ms, a p99 2,57 s lett. Mind a 4 054 kérés sikerült. A korlátozás ugyanazon a gépen futott, a memória és a háttértár a mérőgép erőforrásait használta. Az eredmény a terhelési tüskék alatti ingadozást mutatja, a célkiszolgáló kapacitásához külön mérés kell.

Kipróbáltam a dashboard és a járműkeresés megosztott olvasói sorzárát. Azonos környezetben megismételve, 60 szálnál 103,2-ről 17,5 kérés/mp-re esett az áteresztés, a p95 840 ms-ról 3 887 ms-ra nőtt. A kísérletet visszavettem. A sorzárak, PostgreSQL-várakozások és Npgsql-kapcsolatok együtt vizsgálandók a következő célzott mérésben.

### Újrafuttatás

Használj külön `Development` API-t, külön PostgreSQL-adatbázist és az azon betöltött [demóadatokat](../scripts/seed-demo-data.mjs). A futtató a demófiókok helyi JSON-fájljából olvas, a kimenetre a mérési eredményeket írja. A portot és a fájlt PowerShellben így adhatod meg.

```powershell
$env:HERMES_BENCHMARK_URL = 'http://127.0.0.1:5088'
$env:HERMES_BENCHMARK_ACCOUNTS = '<a tesztpéldány bejelentkezesek.json fájlja>'
$env:HERMES_BENCHMARK_SECONDS = '10'
node scripts/tests/benchmark-api.mjs
```

A [futtató](../scripts/tests/benchmark-api.mjs) minden szakaszhoz közöl p50/p95/p99 értéket, átviteli sebességet, HTTP-státuszt és bontást művelettípusonként. A válaszidőbe a választest letöltése is beleszámít. Az írási ütközést külön, a [foglalási integrációs teszt](../backend/tests/Hermes.Api.Tests/FleetOperationsTests.cs) ellenőrzi.

## Böngésző és gyengébb eszköz

A mérőgép egy Windowsos Intel Core i5-12450H, 31,7 GiB RAM-mal és NVIDIA RTX 2050-nel. Az alábbi mérések buildelt frontenden, Brave/Chromiumban, az elkülönített helyi API-val futottak. A lassított próbák 4× CPU-lassítást és 10 Mbit/s letöltést, 80 ms hozzáadott késleltetést kaptak. A 60 fps-es sorok hardveresen gyorsítottak. A szoftveres WebGL próba SwiftShadert használt. A képkockákat a garázs bemutató módjában, hat másodpercig mértem.

| Böngészőprofil | Belépési űrlap látható | Egy jármű 3D garázsa kész | Bemutató mód |
| --- | ---: | ---: | ---: |
| 1440×900, RTX 2050 | 0,22 s | 2,07 s | 60 fps, p95 16,9 ms |
| 390×844, érintés, lassítás, RTX 2050 | 0,97 s | 4,92 s | 60 fps, p95 16,8 ms |
| 1280×800, lassítás, szoftveres WebGL | 1,12 s | 5,92 s | 6 fps, p95 183,4 ms |
| 390×844, WebGL kikapcsolva | 0,17 s | 2D kezelőfelület | — |

Megnyitottam a dashboardot, a járműlistát és adatlapot, a parkolót, a partner- és céglistát, a felhasználólistát, a profilt, a meghívásokat, a jogosultságcsoportokat és a rendszernaplót. A tankolás és km-rögzítés űrlapja, valamint a parkoló kártyái kikapcsolt WebGL-lel is elérhetők voltak. A négy próbában nem volt JavaScript-futáshiba, HTTP 5xx vagy oldalirányú túlcsordulás az ellenőrzött listákon. A lassított mobilnézet az asztali GPU-t használta. Fizikai, gyenge telefonon és integrált GPU-n továbbra is mérni kell.

Az egyjárműves próbában kb. 1,35 MB HDR-világítás és 1,04 MB GLB érkezett a kliensre. A build három legnagyobb járműmodellje kb. 6 MB egyenként. A lassú eszközökön az első megnyitás és a szoftveres 3D igényli a legtöbb javítást. [Garázs betöltése](../frontend/src/VehicleStudio.tsx) · [Parkoló](../frontend/src/FleetParking.tsx)

## Javítások

- Szűrés nélküli járműlistánál egyetlen összesítés adja a teljes darabszámot. Szűréskor továbbra is külön darabszám készül az összes elérhető járműre és a találatokra. A csak szóközös keresést külön ellenőrzi a lapozási teszt. [Járműlista](../backend/src/Hermes.Infrastructure/Stores.cs) · [Keresési tesztek](../backend/tests/Hermes.Api.Tests/VehicleSearchTests.cs)
- A helyi fejlesztői és előnézeti szerver 404-et ad a hiányzó PDF-segédfájlokra. A PDF worker, a betűkészletek és a WASM-dekóder elérhetőségét külön füstteszt ellenőrzi. [PDF-eszközök](../frontend/pdfAssets.ts) · [Füstteszt](../scripts/smoke-document-preview.mjs)

## Javasolt sorrend

1. **Könnyített járműnézet.** A tankolás, km és foglalás azonnal legyen elérhető, a 3D csak választás után töltődjön be. Gyenge eszközön a lista és a 2D járműkép jó alap. A jelenlegi WebGL-hibaág is használható, de a szoftveres WebGL 6 fps mellett technikailag továbbra is elindul.
2. **Kisebb 3D csomagok.** Először alacsonyabb felbontású HDR-t és GLB-változatot mérnék mobilon. A magasabb felbontású eszközök külön erőforrást kaphatnak. Elfogadási cél a 3D első megjelenése 3 másodpercen belül a mért hálózaton és hardveres WebGL-lel legalább 30 fps a céltelefonokon.
3. **Valós méretű adatbázis és hosszabb próba.** A következő API-próbában 200–500 járművet, 12 havi óraállást, tankolást, foglalásokat és több párhuzamos cégterhelést használnék. A 15 szál mellett 30 percig követném a p95/p99-et, a CPU- és memóriahasználatot, a PostgreSQL-várakozásokat és a kapcsolatpool telítettségét. A mostani adatok alapján a céges sorzár elhagyása önmagában kockázatos, a jogosultsági és foglalási konkurenciatesztek kötelező visszamérések.
4. **Rendszeres böngészős regresszió.** A legértékesebb folyamatok a két közvetlen művelet, a foglalás, a telephelyhatár, a dokumentum-előnézet és a dashboard visszaállítása. Érdemes ezeket valódi böngészős tesztként futtatni a buildelt felületen, legalább egy mobilméreten is.

## Ellenőrzési határok

Az Entra- és e-mail-ellenőrzések tesztkonfigurációval futottak. A Debian/TeamCity telepítését és a teljes visszaállítási próbát ezen a Windows-gépen csak a szkriptek szintjén ellenőriztem. A jelentés modulonkénti ellenőrzést ad. Az ág- és sorkódlefedettség, a fizikai céltelefonok és a hosszú futású, történeti adatokkal felépített terhelés külön vizsgálatot igényelnek.
