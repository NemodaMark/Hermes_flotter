# HERMES – projektösszefoglaló és műszaki áttekintés

**Összeállítva:** 2026. október 27.  
**Az összefoglalt funkcionális állapot:** `a630179`, 2026. október 24.  
**Cél:** az eddig elkészült funkciók, technológiák és a legfontosabb működési szabályok áttekintése fejlesztéshez, bemutatáshoz és műszaki átadáshoz.

## 1. GitHub és a projekt célja

- **GitHub-tároló:** [NemodaMark/Hermes_flotter](https://github.com/NemodaMark/Hermes_flotter)
- **Alapértelmezett fejlesztési ág:** [main](https://github.com/NemodaMark/Hermes_flotter/tree/main)
- **Funkcionális referencia:** [a630179 – a takart 3D menüpontok elrejtése](https://github.com/NemodaMark/Hermes_flotter/commit/a630179c66bd0851135c643f114d890afae8249c)
- **Automatizált ellenőrzések:** [GitHub Actions](https://github.com/NemodaMark/Hermes_flotter/actions)

A HERMES több céget kiszolgáló, magyar felületű flottakezelő webalkalmazás. Egy felhasználói fiók több céghez és telephelyhez férhet hozzá, cégenként és műveletenként eltérő jogosultságokkal. Az alkalmazás a cégek, telephelyek, munkatársak, járművek, partnerek, lízingszerződések, szervizbejegyzések és dokumentumok kezelését kapcsolja össze.

Az elkészült megoldás valódi API-t és PostgreSQL-adatbázist használ. A fejlesztés központi szempontja a céges adatok elkülönítése, a jogosultságok szerveroldali ellenőrzése és a változások követhetősége. A felület ezeket a működő folyamatokat teszi kipróbálhatóvá.

## 2. Használt technológiák és szerepük

Az alábbi verziók a projekt jelenlegi csomag- és konfigurációs fájljait jelölik, nem a technológiák mindenkori legújabb kiadását. A frontend pontos feloldott függőségeit a `package-lock.json`, a backend csomagverzióit a `Directory.Packages.props` rögzíti.

| Technológia | Projektbeli használat |
|---|---|
| **C# / .NET 10 / ASP.NET Core 10** | HTTP API, üzleti végpontok, hitelesítés, jogosultságvizsgálat, feltöltések és egészségellenőrzés. A `global.json` a .NET SDK 10.0.100 verzióját adja meg `latestFeature` továbblépéssel. |
| **ASP.NET Core Identity** | Felhasználói fiókok, jelszóhashek, bejelentkezés, munkamenetek és fiókbiztonsági műveletek. |
| **Entity Framework Core 10** | Adatbázis-modellezés, lekérdezések, migrációk, tranzakciók és verzióellenőrzött mentések. |
| **PostgreSQL 18 / Npgsql** | Tartós üzleti adatok, dokumentumok és képek; adatbázis-korlátok, sorzárak, céges RLS és előzményvédő triggerek. |
| **React 19 / TypeScript 7** | Komponensekre bontott webes felület, típusos API-kliens, űrlapok, adatlapok, listák és dashboardok. |
| **Vite 8 / Node.js** | Frontend-fejlesztői kiszolgáló, API-proxy és kiadási csomag készítése; Node.js-alapú mintaadat-, smoke- és modell-előkészítő scriptek. |
| **TanStack Query 5** | Szerveradatok lekérése, gyorsítótárazása, frissítése és a módosítások utáni újratöltés. A céges lekérdezések felhasználó- és cégazonosítóhoz kötöttek. |
| **Sera UI minták és saját CSS** | A gombok, jelvények és fülvezérlők kézzel beépített, átalakított komponensek. A stílusok HERMES CSS-változókat használnak; nincs Tailwind- vagy Framer Motion-futtatókörnyezet. |
| **Saját Select, Toggle és Table komponensek** | Közös megjelenésű választók és kapcsolók; kereshető/írható mezők, billentyűzetes kezelés, kattintható és váltakozó háttérszínű táblasorok. |
| **IBM Plex Sans / Lucide React** | Helyben csomagolt betűkészlet és egységes ikonok a sötétkék–türkiz felületen. |
| **Three.js / WebGL2** | Körbeforgatható 3D járműnézet, kameramozgás, modellbetöltés, fényezés és geometriai takarásvizsgálat. |
| **PDF.js (`pdfjs-dist`)** | PDF-ek alkalmazáson belüli, lapozható és nagyítható előnézete; helyi workerrel, betűkészletekkel és dekódolókkal. |
| **StbImageSharp / StbImageWriteSharp** | Feltöltött profil- és járműképek szerveroldali dekódolása, átméretezése és metaadatmentes újrakódolása. |
| **Docker / Docker Compose / Nginx** | Elkülönített adatbázis-, migrációs, API- és frontend-szolgáltatások; a kész webes fájlokat Nginx szolgálja ki. |
| **Caddy / HTTPS** | Debian 13 alatt a publikus belépési pont, HTTP→HTTPS átirányítás és automatikus tanúsítványkezelés. |
| **restic / pg_dump / systemd** | Titkosított mentés, adatbázismentés, időzített futtatás és elkülönített visszaállítási próba. |
| **WPF / .NET 10** | Külön natív Windows rendszervezérlő a helyi fejlesztői szolgáltatásokhoz. |
| **Vitest / Testing Library / jsdom / Oxlint** | Frontend-folyamatok és komponensek tesztelése, valamint statikus kódellenőrzés. |
| **xUnit / ASP.NET Core tesztkiszolgáló / Testcontainers** | Backend-integrációs tesztek valódi PostgreSQL-lel; külön Windows/Linux rendszervezérlő-tesztek. |
| **GitHub Actions** | Frontend-, backend-, konténer-, Windows- és Debian-telepítési ellenőrzések push és pull request esetén. |

## 3. Felépítés és egy kérés útja

```text
frontend/                         React webalkalmazás és közös UI-komponensek
backend/src/Hermes.Api/            HTTP-végpontok és API-védelmek
backend/src/Hermes.Application/    Szerződések, DTO-k és interfészek
backend/src/Hermes.Domain/         Entitások, jogkatalógus és alapfogalmak
backend/src/Hermes.Infrastructure/ EF Core, Identity és üzleti szolgáltatások
backend/tests/Hermes.Api.Tests/    PostgreSQL-es integrációs tesztek
desktop/                          Windows rendszervezérlő és tesztjei
deploy/debian13/                  HTTPS-es telepítés, mentés és visszaállítás
infra/postgres/                   Adatbázis-szerepkörök inicializálása
scripts/                          Indító-, mintaadat- és ellenőrző scriptek
.github/workflows/                CI-folyamatok
```

A backend jelenleg egyetlen API-alkalmazás, több elkülönített projektbe szervezett kóddal. Az üzleti szolgáltatások jelentős része az Infrastructure projektben található az adatkezelés mellett. A webes oldalak között hash-alapú navigáció működik, például `#/dashboard`, `#/vehicles` és `#/companies` útvonalakkal.

Egy tipikus járműmódosítás folyamata:

1. A frontend az aktuális céggel, munkamenetsütivel és CSRF-tokennel küldi a kérést.
2. Az API az `X-Tenant-Id` fejlécből azonosítja a céget, és ellenőrzi a felhasználó aktuális hozzáférését.
3. A szolgáltatás a konkrét műveleti jogot és annak telephelykorlátját is vizsgálja.
4. Az adatverzió és az üzleti szabályok ellenőrzése után tranzakcióban módosítja az adatot és a naplót.
5. Az adatbázis további kapcsolati, egyediségi és céges elkülönítési szabályokat érvényesít.
6. A frontend a választ feldolgozza, és frissíti az érintett adatokat. Elavult verziónál nem írja felül csendben más munkáját.

## 4. Elkészült felhasználói funkciók

### 4.1. Fiókok, bejelentkezés és profilok

- Regisztráció, belépés felhasználónévvel vagy e-maillel, kijelentkezés és oldalfrissítést túlélő munkamenet.
- Az egyedi, kanonikus **felhasználónév maga a belső felhasználói azonosító**; a név és az e-mail ettől külön adat. A korábbi azonosítók történeti feloldáshoz megmaradnak.
- A jelszavakat Identity kezeli sózott hashként. A normál jelszókövetelmény 12–128 karakter; ismételt hibás belépésre fiókzárolás és belépési sebességkorlát működik.
- Teljes oldalas felhasználói adatlap külön **Profiladatok**, **Céges hozzáférések** és **Fiókbiztonság** fülekkel, joghoz igazodó eléréssel.
- Saját név, telefonszám és profilkép kezelése; közös aktív cégtagság esetén a kolléga alapadatainak megtekintése.
- A profilon megjelennek a felhasználónál lévő, a megtekintő számára engedélyezett aktuális járművek.
- Rendszerszintű kezelőnek globális fiókkezelés és kötelező jelszócsere előírása. A kötelező csere a backend üzleti végpontjait is lezárja a sikeres csere elvégzéséig.
- Egy felhasználólista; a rendszerszintű kezelő **Összes felhasználó** kapcsolóval a céges hozzáférés nélküli fiókokat is láthatja.

### 4.2. Cégek, telephelyek és kapcsolattartók

- Céglétrehozás, céglista, keresés, állapotszűrés, szerkesztés, felfüggesztés, archiválás és visszaállítás.
- Cégnév, hivatalos adatok, székhely, elérhetőségek, időzóna, pénznem és távolságegység tárolása.
- Az időzóna és a pénznem listából választható. Az adószámmezők lekerültek a cégűrlapról; a korábban tárolt adatok megmaradnak.
- Céges kapcsolattartók felvétele, módosítása, archiválása és visszaállítása.
- Telephelynév, telephelykód, cím, elérhetőségek és kapcsolattartó kezelése; telephelyek archiválása és visszaállítása.
- Járművek telephelyhez rendelése és áthelyezése, a forrás- és céltelephelyhez tartozó jogok vizsgálatával.
- Egy közös munkaterület-választó kezeli a céget és a telephelyet. A kijelölés egy sorban látszik.
- Tagolt cég- és telephelyűrlapok, valamint saját módosítási napló.

### 4.3. Meghívások és egységes jogosultságcsoportok

- Önálló **Meghívások** és **Jogosultságcsoportok** oldalak.
- E-mail-címhez kötött, visszavonható, egyszer használható meghívók; a meghívó 7 napig érvényes.
- A meghívó hivatkozása létrehozáskor egyszer jelenik meg, kézzel továbbítható. A token hashként kerül az adatbázisba.
- Céges hozzáférések felfüggesztése és visszaállítása; egy cégben történő felfüggesztés nem szünteti meg a többi céghez tartozó hozzáférést.
- Közvetlen jogkiosztás és **egyetlen közös csoportmodell**. Egy egyéni csoporthoz több cég és jogcsomag rendelhető; nincs külön céges és többcéges csoporttípus.
- A csoporton belül cégenként teljes céges vagy kijelölt telephelyekre korlátozott hozzáférés adható.
- A cégkezelő csak a saját kezelési és delegálási körébe tartozó cégeken dolgozhat. A részleges módosítás a más cégekhez tartozó hozzárendeléseket megőrzi.
- Védett közös **admin** csoport, felhasználónként kijelölt cégekkel. Minden jelenlegi és jövőbeli céges jogot megkap, de önmagában nem ad `system.manage` jogot.
- A rendszer védi az utolsó aktív jogosultságkezelőt, és a hozzáférés-változásokat naplózza.

### 4.4. Járműkezelés és használati előzmények

A jármű belső azonosítója UUID maradt; a felületen a **rendszám** az elsődleges azonosító. Rendszám- vagy országváltáskor megmaradó előzmény készül, és a korábbi rendszám alapján is kereshető az autó.

| Adatcsoport | Főbb mezők és funkciók |
|---|---|
| Azonosítás és alapadatok | Rendszám, országkód, VIN, flottaazonosító, gyártó, modell, karosszéria, kategória, gyártási év, első forgalomba helyezés, szín. |
| Műszaki adatok | Üzemanyag/hajtás, teljesítmény, hengerűrtartalom, váltó, ülésszám, össztömeg, terhelhetőség, raktérfogat, akkumulátorkapacitás. |
| Üzemeltetés | Állapot, tulajdonlási forma, flottába kerülés és kilépés, telephely, használó, megjegyzés. |
| Határidők | Műszaki vizsga, biztosítás, következő szerviz dátuma és kilométerhatára, alapértelmezett szervizpartner. |
| Előzmények | Rendszám-, kilométer- és használati előzmények, módosítási napló. |
| Kapcsolódó adatok | Fotók, járműokmányok, lízing-/bérleti szerződések és szervizbejegyzések. |

Az új jármű és a szerkesztés közös, teljes mezőkészletet használ. A gyártó és modell írható választómező; a mentett értékek **cégenként** tanuló javaslatlistát bővítenek. A hosszú adatlap mezőcsoportokra és külön adatlaprészekre tagolódik, a piszkozat megőrzésével.

A kilométer-rögzítés külön műveleti jog, nem igényel általános járműszerkesztési jogot. Archivált jármű olvasható maradhat, módosítása indokolt visszaállításhoz kötött.

A **Használati előzmények** megmutatja, kinél volt a jármű, mettől meddig, ki rendelte hozzá, illetve ki zárta le a hozzárendelést. Használóváltáskor a régi időszak lezárása és az új megnyitása egy tranzakcióban történik. A használó kijelölése önmagában nem ad hozzáférést a járműhöz.

### 4.5. Partnerek, lízing és szerviz

- Cégenként külön partnertörzs, **lízingbeadó** és/vagy **szerviz** kategóriával.
- Partnercímek, elérhetőségek, kapcsolattartók, megjegyzések és archiválás kezelése.
- Járműhöz kötött lízing- és bérleti szerződések: partner, szerződésszám, időszak, díj, pénznem, fizetési gyakoriság, kilométerkeretek, állapot és dokumentumok.
- Aktív lízing csak lízingelt vagy bérelt járműhöz tartozhat; az aktív szerződések időszakai nem fedhetik egymást.
- Szervizbejegyzések: partner, dátum, munkalapszám, munkaleírás, történeti kilométer, költség, következő szerviz adatai és csatolmányok.
- Hibás szervizbejegyzés indoklással érvényteleníthető, történetből törléssel nem tüntethető el.
- A szervizben rögzített történeti kilométer vagy következő határidő nem írja át automatikusan a jármű aktuális adatait.
- Aktív szerződésben használt lízingbeadó, illetve alapértelmezett szervizpartner nem archiválható az érintett kapcsolat feloldása nélkül.

### 4.6. Dokumentumok, előnézet és képek

Fájl közvetlenül a járműhöz, egy lízingszerződéshez vagy egy szervizbejegyzéshez tölthető fel. A közvetlen járműokmányok kategóriái: **forgalmi engedély**, **biztosítás**, **műszaki vizsga**. Webes dokumentumhivatkozás megadása is megmaradt a lízing- és szervizadatoknál.

- Dokumentumformátumok: PDF, JPG, PNG, DOCX és XLSX; fájlonként legfeljebb **10 MiB**.
- PDF- és képelőnézet közvetlenül az alkalmazásban, nagyítással és szélességhez igazítással; PDF-nél lapozással. DOCX/XLSX letöltéssel nyitható meg.
- A letöltés és az előnézet frissen hitelesített, jogellenőrzött végpontot használ; nincs nyilvános csatolmány-URL.
- Az eredeti tartalom, kategória és szülőhivatkozás változatlan. Hibás csatolmány indokolt visszavonással kezelhető, az eredeti fájl felülírása nélkül.
- A bináris tartalom és metaadat PostgreSQL-ben található; a feltöltés, a verzióváltás és az audit együtt mentődik.
- A járműfotók opcionálisak: **0–5 JPG/PNG**, képenként legfeljebb **5 MiB**. Profilkép is feltölthető.
- A képeket a backend dekódolja, átméretezi és metaadat nélkül újrakódolja. Ezek is az adatbázisban maradnak, ezért a teljes adatbázismentés tartalmazza őket.

A fájlfeltöltési, képkezelési és közvetlen előnézeti folyamatok ugyanúgy követik a céges és jogonkénti telephelykorlátokat, mint a többi járműművelet.

### 4.7. Áttekintő és autós dashboard

Belépés után a kezdőlap nyílik meg. A kezdőnézet **jogosultságcsoportonként** állítható, 0–1000 közötti prioritással. Több csoport esetén a nagyobb prioritás dönt; eltérő nézetek azonos prioritásánál az áttekintő indul. A kézi nézetváltás az aktuális látogatásra érvényes.

**Áttekintő nézet:** járműállapotok összesítése, lejárt és 30 napon belül esedékes határidők, valamint telephelyi megoszlás. Csak a felhasználó számára megtekinthető járművekből számol.

**Autós nézet:** egyszerre egy elérhető járműre fókuszál. Először a felhasználóhoz rendelt, megtekinthető járművet választja; a járművek között rendszámmal lehet váltani.

A Forza Vista inspirálta működés saját Three.js-megvalósítás:

- 360 fokos körbeforgatás, zoom, kameragombok és animált kameramozgás.
- Kattintható pontokról megnyitható a tényleges járműadatlap megfelelő része. Ugyanezek az alsó gyorsmenüből is elérhetők.
- A pontok a modell külső felületére illeszkednek. A túloldali vagy karosszéria által takart pont **a vonalával és feliratával együtt eltűnik**, és rejtve billentyűzettel sem aktiválható.
- **12 külön modell** fedi le az ismert karosszériatípusokat. Az ismeretlen/egyéb típus jelzett általános modellt kap.
- A fényezés a jármű mentett színét követi; magyar/angol színnév és `#RRGGBB` kód támogatott. Az üveg, gumik és utastér saját anyaga megmarad.
- A GLB-modellek az alkalmazás részei; csak a kiválasztott modell töltődik be. WebGL-hiány vagy betöltési hiba mellett az alsó menü használható marad.
- A dashboard nem ad többletjogot: a lízing-, szerviz- és dokumentummenük az adott jármű saját jogosultságait követik.

**Modellek és licencek:** a kupé a Khronos Car Concept modelljét használja, Eric Chadwick / Darmstadt Graphics Group, **CC BY 4.0** licenccel és feltüntetett módosításokkal. A többi karosszériamodell Innerscene-forrású, **CC0** licencű; az alvázas a dobozos modell módosítása. Ezek általános karosszéria-illusztrációk, nem a megadott márka és modell pontos másolatai. Forza-játékból származó assetet nem használunk.

Az előkészítő scriptek forrás-ellenőrzőösszegeket vizsgálnak; a licencek és származási adatok a `frontend/public/models/` mappában, a többi felhasznált UI-/3D-forrás a [THIRD_PARTY_NOTICES.md](frontend/THIRD_PARTY_NOTICES.md) fájlban található.

### 4.8. Egységesebb felület

Elkészültek a közös eszköztárak, kereshető választók, kapcsolók, váltakozó hátterű és kattintható táblasorok. A listaoldalak ismétlődő címsávjai csökkentek; a fő műveletek és szűrők közös helyre kerültek. Az adatlapok fülekkel és mezőcsoportokkal csökkentik az egyszerre látható mezők számát.

A rendszerszintű napló **Beállítások → Rendszerkezelés** alatt érhető el a megfelelő joggal. A munkaterület-váltó, a profiloldalak és az űrlapok billentyűzetes, illetve kisebb képernyős használata is kapott támogatást.

## 5. A legfontosabb jogosultsági és adatvédelmi szabályok

### Műveleti jogok és telephelyek

A jogok műveleteket engedélyeznek: például `vehicles.read`, `vehicles.update`, `vehicles.odometer.create`, `vehicles.users.assign`, `vehicles.leasing.manage`, `vehicles.service.manage` és `vehicles.documents.read`. A partnerkezelés, cégkezelés, csoportkezelés és rendszerszintű kezelés külön jogokat kapott.

**Lényeges különbség:** a céges `admin` jogcsomag és a globális `system.manage` jog két külön fogalom. Egy cég adminisztrátora ettől nem válik a teljes rendszer kezelőjévé.

A közvetlen és csoportos jogok összeadódnak, de a jogot mindig a saját forrásához tartozó telephelykörrel együtt kell értelmezni. Például:

- Az A telephelyre kapott szerkesztési jog és a B telephelyre kapott kilométer-rögzítési jog nem ad szerkesztési jogot B-re.
- Telephely nélküli járművet csak az adott műveletre teljes céges joggal lehet elérni.
- Jármű megtekintése nem jogosít automatikusan lízing-, szerviz-, dokumentum- vagy partneradatok olvasására.
- A dashboard, profil, közvetlen fájlelérés és napló sem kerülheti meg ezeket a korlátokat.

### Több rétegű elkülönítés

1. A backend ellenőrzi a hitelesített fiókot, az aktív céges hozzáférést és a konkrét műveletet.
2. Az EF Core céges lekérdezési szűrést és mentési ellenőrzést alkalmaz.
3. A céges üzleti táblákat PostgreSQL **FORCE ROW LEVEL SECURITY**, összetett kapcsolatok és egyéb korlátok is védik.

A globális Identity-fiókok és a cégválasztáshoz szükséges nyilvántartások eltérő, kifejezett szerveroldali feltételeket használnak; nem minden tábla tenant-RLS-es. Az API adatbázis-felhasználója nem superuser, nincs `BYPASSRLS` joga, és nem azonos a migrációs felhasználóval.

### Munkamenet, verziók és napló

A belépés `HttpOnly`, `SameSite=Lax` sütit használ, Production környezetben HTTPS-hez kötve. A módosító kérések CSRF-védettek. A frontend nem tárol belépési tokent a localStorage-ban. A céges jogokat a backend frissen ellenőrzi; nem a belépéskori sütiből veszi őket.

A szerkeszthető adatok verziószámot kapnak. Elavult verziónál a szerver ütközést jelez, és a kezelőnek friss adatot kell betöltenie. A több céget érintő jogosultságmódosítások atomikusak; az adat és a hozzá tartozó napló együtt mentődik.

A napló rögzíti a műveletet, az időpontot, a kezdeményezőt és az érintett változást. Több előzmény- és naplótábla hozzáfűzött működését adatbázistriggerek is védik. A megjelenítés a régi felhasználói azonosítókat feloldhatja, az eredeti történeti sor átírása nélkül.

## 6. Telepítés, HTTPS, mentés és visszaállítás

### Fejlesztői környezet

A gyökér `compose.yaml` PostgreSQL-, migrációs, API- és frontend-szolgáltatást indít. Külön natív fejlesztői futtatás is rendelkezésre áll .NET SDK-val, Node.js-szel és PostgreSQL-lel.

| Szolgáltatás | Szokásos helyi cím |
|---|---|
| Vite frontend | `http://127.0.0.1:5173/` |
| API | `http://127.0.0.1:5080/api/v1` |
| Konténeres frontend | `http://localhost:8080/` |
| Készenlét / futó verzió | `/health/ready`, `/health/version` |

A portok konfigurálhatók; ezen a fejlesztői gépen a natív PostgreSQL korábban az 55432-es portot használta. Fejlesztéskor a Vite továbbítja az `/api` és `/health` kéréseket a backendhez, így a böngésző azonos eredetű kérésekkel dolgozik.

Indítási leírás: [README.md](README.md), [backend/README.md](backend/README.md), [frontend/README.md](frontend/README.md).

### Debian 13 tesztszerver

Elkészült a külön, Production környezetet használó telepítési csomag a `deploy/debian13/` mappában. Caddy kezeli a HTTPS-t és a tanúsítványmegújítást; csak a proxy 80/443 portja publikus. Az adatbázis és az API belső hálózaton kommunikál. A migráció külön, erre jogosult adatbázis-szerepkörrel fut.

| Üzemeltetési funkció | Elkészült működés |
|---|---|
| Telepítés és frissítés | Commitolt forrásból konténerképek készítése, frissítés előtti mentés, migráció és készenlét-ellenőrzés. |
| Napi mentés | systemd időzítő, 03:15 UTC körül, legfeljebb 10 perc véletlen késleltetéssel. |
| Mentési tartalom | Konzisztens `pg_dump`, dokumentumok és képek, alkalmazáskulcsok, TLS-adatok, védett konfiguráció, forráscsomag és a futó konténerképek. |
| Titkosítás és megőrzés | restic; legalább 3 utolsó mentés, továbbá 7 napi, 4 heti és 3 havi példány. |
| Heti próba | Vasárnap 04:30 UTC körül repository-ellenőrzés és elkülönített adatbázis-/API-visszaállítás. |
| Teljes helyreállítás | Mentett adatbázis és hozzá tartozó alkalmazásverzió visszaállítása új, üres célra. |

A visszaállítási próba nem módosítja a működő adatbázist és nem publikál portot. A teljes kör a Debian CI-folyamatban is szerepel. A saját szerveren a DNS-t, nyilvános ACME-tanúsítványt, mentési tárhelyet és újraindulást külön kell ellenőrizni; a csomag elkészülte nem jelent automatikus távoli telepítést.

A részletes, követendő parancsok és helyreállítási feltételek: [Debian 13 üzemeltetési leírás](deploy/debian13/README.md). A restic-jelszó külön megőrzendő, nem szerepel a saját mentésében. A valós konfigurációk és hitelesítő adatok nem kerülnek Gitbe.

### Windows rendszervezérlő

Külön WPF-alkalmazás figyeli a helyi backend, frontend és PostgreSQL állapotát. Megjeleníti a health-válaszokat, folyamatokat, erőforrásadatokat, naplókat és a futó verziót; egyenként vagy függőségi sorrendben újraindítja a saját szolgáltatásait.

A Git-ellenőrzés fetch műveletet végez, automatikus pullt vagy fájlfelülírást nem. A vezérlő a helyi natív fejlesztői folyamatokat kezeli; nem Debian-adminisztrációs felület. Részletek: [desktop/README.md](desktop/README.md).

## 7. Mintaadatok

Elkészült és korábban betöltésre került a külön **Demo Flotta** adathalmaz. A betöltő tervezett, ellenőrzött tartalma:

| Adat | Mennyiség |
|---|---:|
| Cég | 1 |
| Telephely / céges kapcsolattartó | 3 / 3 |
| Demófiók / jogosultságcsoport | 10 / 8 |
| Jármű | 30 |
| Partner | 5 |
| Lízing-/bérleti szerződés | 18 |
| Szervizbejegyzés | 60 |

A készletben telephelykorlátos hozzáférések, felfüggesztett tagság, telephely nélküli autók, eltérő állapotok, határidők és használati előzmények is szerepelnek. A fiókokhoz egyedi demójelszó készül; a céges tagság felfüggesztése és a globális bejelentkezés külön szabály marad.

A `scripts/seed-demo-data.mjs` csak helyi, Development API-val és meglévő rendszerszintű kezelővel működik. A normál API-t használja, ezért a változások jogellenőrzöttek és naplózottak. Az előrehaladást helyi állapotfájl őrzi; újrafuttatáskor ez alapján folytat vagy ellenőriz. Production indítás nem tölt be demóadatot.

A jelszavak a Gitből kizárt `.local/demo-data/bejelentkezesek.json` fájlban vannak; tartalmuk nem része ennek a dokumentumnak. A fenti számok a létrehozott mintakészletet írják le, nem a dokumentumkészítéskor végzett élő adatbázis-leltárt. Használat és korlátok: [backend/README.md – Helyi mintaadatok](backend/README.md#helyi-mintaadatok).

## 8. Ellenőrzés és automatizálás

A tesztek kiterjednek többek között a cégek elkülönítésére, közvetlen és csoportos jogokra, telephelykorlátokra, delegálásra, verzióütközésekre, előzményekre, dokumentumokra, képekre és a felületi folyamatokra. A 3D tesztek a csomagolt modellek geometriáját, színezését, modellváltását és a pontok takarását is vizsgálják.

**Utolsó, ebben a fejlesztési folyamatban rögzített teljes frontendellenőrzés:** 2026. október 24-én 164 sikeres teszt, sikeres build és lint az `a630179` állapothoz. Ez korábbi ellenőrzési eredmény; az összefoglaló megírása nem jelent újabb teljes alkalmazástesztet.

Fő ellenőrző parancsok a projekt gyökeréből:

```powershell
# Frontend
npm --prefix frontend ci
npm --prefix frontend run test -- --maxWorkers=2
npm --prefix frontend run build
npm --prefix frontend run lint

# Backend – Dockerrel elérhető PostgreSQL-tesztkörnyezet szükséges
dotnet test backend/Hermes.slnx -c Release

# Windows rendszervezérlő
dotnet test desktop/tests/Hermes.ControlCenter.Tests/Hermes.ControlCenter.Tests.csproj -c Release
```

A backend Testcontainers segítségével valódi PostgreSQL-t indít. Alternatív elkülönített tesztszerver is megadható a dokumentált változóval; a tesztek saját ideiglenes adatbázist használnak. A HTTP smoke tesztek tesztadatokat hoznak létre, ezért kizárólag elkülönített, eldobható környezetben futtatandók.

A [CI-konfiguráció](.github/workflows/ci.yml) hat feladatot tartalmaz: `frontend`, `backend`, `containers`, `control-center-core`, `control-center-windows`, `debian-staging`. A Debian-folyamat ellenőrzi a scripteket és systemd-egységeket, valamint a HTTPS-es tesztelést, mentést és helyreállítást. A frontend CI tesztet és buildet futtat; a lint külön helyi parancs.

## 9. Jelenlegi határok és nyitott bővítések

- Nincs automatikus meghívólevél-küldés, e-mail-megerősítés vagy elfelejtettjelszó-folyamat.
- A regisztráció jelenleg nyitott; a tesztszerver külső hozzáférésének korlátozását az üzemeltetési leírás tárgyalja.
- Nincs teljes előfizetés-, számlázás-, üzemanyag- vagy összesített flottaköltség-modul. A szerződésdíjak és szervizköltségek már rögzíthetők.
- A járműlista keresése/szűrése jelenleg kliensoldali; nagy flottához szerveroldali keresés és lapozás további feladat.
- A mentések eredménye systemd-naplóból ellenőrizhető; külső automatikus e-mailes/riasztási integráció nincs.
- A 3D modellek karosszériatípust és színt szemléltetnek. Márka-/modellhű 3D katalógus nem készült.

## 10. Hol találhatók a legfontosabb megvalósítások?

| Rész | Fő források |
|---|---|
| API-indítás, hitelesítés, tenant és CSRF | `backend/src/Hermes.Api/Program.cs`, `TenantResolutionMiddleware.cs`, `CsrfProtectionMiddleware.cs`, `AccountSecurity.cs` |
| Jogkatalógus és hozzáférési szabályok | `backend/src/Hermes.Domain/Permissions.cs`, `backend/src/Hermes.Infrastructure/AccessRules.cs`, `VehicleAccess.cs`, `GroupManagement.cs` |
| Cégek, telephelyek, munkatársak | `OrganizationManagement.cs`, `MemberManagement.cs`, `PeopleManagement.cs` az Infrastructure projektben |
| Járművek, partnerek, szerződések | `FleetManagement.cs`, `PartnerManagement.cs`, `VehicleContractsManagement.cs` az Infrastructure projektben |
| Dokumentumok és képek | `DocumentManagement.cs`, `DocumentValidation.cs`, `VehicleMediaManagement.cs`, `ImageProcessing.cs` az Infrastructure projektben |
| Adatbázis és migrációk | `backend/src/Hermes.Infrastructure/HermesDbContext.cs`, `Migrations/`, `TenantTransaction.cs` |
| Webes keret és munkaterület | `frontend/src/App.tsx`, `api.ts`, `WorkspaceSwitcher.tsx`, `ui/` |
| Adatlapok és dokumentumelőnézet | `frontend/src/VehiclePage.tsx`, `UserProfilePage.tsx`, `CompaniesPage.tsx`, `DocumentPreview.tsx`, `PdfPreview.tsx` |
| Dashboard és 3D | `frontend/src/DashboardPage.tsx`, `VehicleStudio.tsx`, `vehicleModels.ts`, `vehicleSceneModel.ts`, `vehicleHotspots.ts` |
| Modell-előkészítés és licencek | `scripts/prepare-khronos-car.mjs`, `scripts/prepare-vehicle-bodies.mjs`, `frontend/public/models/`, `frontend/THIRD_PARTY_NOTICES.md` |
| Telepítés és visszaállítás | `deploy/debian13/hermes.sh`, `compose.yaml`, `compose.restore.yaml`, `systemd/`, `tests/roundtrip.sh` |
| Helyi rendszervezérlő | `desktop/src/Hermes.ControlCenter/`, `desktop/src/Hermes.ControlCenter.Core/` |

A részletes végpontlistákat és indítási útmutatókat a [projekt README](README.md), a [backend](backend/README.md), a [frontend](frontend/README.md), a [Debian-telepítés](deploy/debian13/README.md) és a [Windows rendszervezérlő](desktop/README.md) leírása tartalmazza.
