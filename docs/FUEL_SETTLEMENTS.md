# Havi üzemanyag- és magánhasználati elszámolás

Elkészült: **2026. november 23.**

## Elérés és munkafolyamat

A kezdőlapon a **Továbbiak → Havi km-elszámolás → Magánhasználati díj** részen érhető el. A kizárólag új elszámolási joggal rendelkező felhasználó közvetlenül ezt a nézetet kapja. A kilométer-bevallás és a pénzügyi elszámolás külön nyilvántartás: az egyik teljes havi futáskeretet, a másik ingyenes magánkilométer-keretet kezel.

1. Válaszd ki a lezárult hónapot. A kezelő céges felhasználót is választhat.
2. Add hozzá a járműveket, nyitó/záró óraállást, magánkilométert, havi litert és üzemanyagárat.
3. A liter kézzel is megadható, vagy átvehető a HERMES adott havi, érvényes tankolásaiból. A rendszer nem találja ki a hiányzó hónapvégi óraállást.
4. A **Számítás ellenőrzése** mentés nélkül megmutatja a levezetést. A **Piszkozat mentése** hiányos adatokkal is használható.
5. A már mentett, hibátlan és lezárult havi elszámolás **beküldhető**. Ezután külön joggal **jóváhagyható**.
6. A jóváhagyott elszámolásból letölthető a bérszámfejtési CSV. A tényleges bérlevonást és pénzügyi teljesítést a HERMES nem végzi el.

A beküldött és jóváhagyott állapot nem szerkeszthető. Kezelő indoklással újranyithatja. Az új változat ismét beküldést és jóváhagyást igényel; a korábbi jóváhagyott változat megmarad az előzményekben. A módosításokhoz verzióellenőrzés tartozik, a meglévő piszkozat javítása indoklást kér.

## Számítás

Az alapértékek a vizsgált 2026-os Excel-szabályt követik: **350 km ingyenes magánkeret, az első 500 fizetős km 30 Ft/km, a további fizetős km 50 Ft/km**. Ezek beállítható céges alapértékek; kezelő egy adott havi személyes elszámolásnál eltérő keretet is megadhat. A szabályok a személyes elszámolással együtt mentődnek, a későbbi céges beállítás nem írja át a korábbi hónapokat.

```text
havi futás = záró km − nyitó km
havi elszámolási fogyasztás = havi tankolt liter / havi futás × 100
fizetős magán km = max(0, magán km − ingyenes magánkeret)
üzemanyagköltség = fizetős magán km × fogyasztás / 100 × havi üzemanyagár
havi díj = üzemanyagköltség + I. díjsáv díja + II. díjsáv díja
```

Több autó esetén személyenként, cégenként és havonta egyszer jár a keret és az első díjsáv. Az ingyenes keretet a magánkilométerek arányában, az első díjsávot a fizetős kilométerek arányában osztja szét a rendszer. A számítás ezért nem függ a sorok sorrendjétől. Mindegyik autó saját fogyasztásával és megadott üzemanyagárával számol. A HUF sorösszeg két tizedesre, a fél értékeket nullától elfelé kerekítve készül; a havi összeg ezek összege. A fogyasztást a díjszámítás előtt nem kerekíti le.

A mennyiségek három, a díjtételek négy, a megállapodás szerinti összeg két tizedesjegyet fogad el. A jármű tényleges óraállás-előzménye változatlanul külön, hozzáfűzött nyilvántartás.

Az elszámolási fogyasztás a régi Excel havi liter/futás módszere. A meglévő, teletanktól teletankig mért fogyasztási mutató külön megmarad. Ez a két mutató nem cserélhető fel automatikusan. Az üzemanyagár kézi havi adat, forrásmegjelöléssel; nincs automatikus NAV-, árfolyam- vagy adószabály-letöltés. A modul jelenleg HUF elszámolást készít. A munkaviszonyhoz kötött, korábban bizonytalan keretnövelés nem fut automatikusan; a kezelő a megerősített személyes keretet állítja be.

## Hiányzó adatok és kivételek

- Az üres magánkilométer nem nulla: piszkozatban megőrizhető, beküldést nem enged.
- A teljes futásnál nagyobb magánkilométer, csökkenő óraállás, szükséges liter vagy üzemanyagár hiánya megakadályozza a beküldést.
- Az ingyenes kereten belüli, egyébként érvényes bevallás díja nulla; ehhez nincs szükség fizetős üzemanyagárra.
- HERMES-tankolásból átvételnél az üres hónap hiányzó literadat marad. A mentett liter és számítás pillanatfelvétel: későbbi tankolásjavítás nem változtatja meg észrevétlenül. A kezelő újranyitás után tudja frissíteni.
- Egyedi havi megállapodás csak kezelési joggal és indoklással adható meg. A normál számítás és az elszámolandó egyedi összeg külön látszik. Ez nem helyettesíti a szükséges alapadatok pótlását.
- A személyes km-bevallás és a pénzügyi elszámolás nem adódik össze; a pénzügyi nyilvántartás nem ír új megtett kilométert a járműhöz vagy a km-bevallásba. A havi pénzügyi bevallásba az adott autóhoz tartozó magánkilométert kell megadni.

## Régi Excel / ZIP átvétele

A kezelő az **Excel / ZIP próbaimport** részen választ fájlt és évet. Az előnézet nem ír az adatbázisba. A szerver kizárólag az XLSX OOXML-adatokat és a mentett cellaértékeket olvassa; nem futtat képleteket, makrókat, programokat, és nem követ külső fájlhivatkozásokat. Az eredeti fájlok mentett értékei elavultak is lehetnek, ezért az újraszámítás mellett külön megmaradnak.

Az előnézet az ismert havi sablont ismeri fel, és jelzi az üres magánkilométert, hiányzó árat, eltérő képletet, hibás futást és több lehetséges forrást. A kiválasztott havi sort a kezelő **kanonikus HERMES-felhasználóhoz és meglévő járműhöz** rendeli. Teljes név alapján nem jön létre automatikus fiók. Az autó jelenlegi vagy korábbi rendszámának egyeznie kell a forrással; az elgépelést előbb rendezni kell.

Az átvétel új piszkozatot készít. Ha a személynek arra a hónapra már van elszámolása, nem írja felül. Egy importált havi forrásban a személyes keret már a forrás hónap szerinti értékét követi. Több autós hónapnál a kezelő a meglévő piszkozat további járműsorait kézzel adhatja hozzá, a személyes keret egyszeri alkalmazásával.

Az eredeti kiválasztott munkafüzet bájtjai, SHA-256 lenyomata, forrásfájlneve, munkalapja, díjképlete és mentett végösszege PostgreSQL-be kerül. Importált forrássor nem törölhető; a bevallás javítható, az eredeti bizonyíték megmarad. Az egész éves forrás munkafüzetet csak az adott járműre kezelési joggal rendelkező felhasználó töltheti le, mert más használók hónapjait is tartalmazhatja.

Az Excel végösszegéhez képesti eltérés beküldést blokkoló egyeztetést kér. A jogosult kezelő indokolt megállapodással rögzítheti az elfogadott havi összeget. Sem a régi, sem az új összegből nem lesz automatikusan jóváhagyott követelés.

A feltöltés legfeljebb 100 MB; az archívumban legfeljebb 3000 bejegyzés és 150 MB kitömörített tartalom, egy XLSX-ben legfeljebb 32 MB XML/tartalom engedett. Nem történik tetszőleges fájlkibontás a szerver fájlrendszerébe. A parser a céges zárolás előtt fut, a mentés előtt a jogosultságokat ismét ellenőrzi a szerver.

## Jogosultságok

| Jog | Művelet |
|---|---|
| `vehicles.settlements.read` | Saját havi pénzügyi elszámolás olvasása |
| `vehicles.settlements.record` | Saját, a hónapban hozzárendelt autók elszámolása és beküldése |
| `vehicles.settlements.manage` | Céges elszámolások kezelése, keret/kivétel, import és újranyitás |
| `vehicles.settlements.approve` | Beküldött elszámolások olvasása és jóváhagyása |
| `settlements.configure` | Céges, kezdőhónaphoz kötött szabályok mentése |

A `vehicles.*` jogok saját forráscsoportjuk telephelykorlátját követik. A kezelés és jóváhagyás hatóköre nem kombinálódik: az A telephely kezelése és B telephely jóváhagyása nem jogosít A jóváhagyására. Telephely nélküli autóhoz teljes céges műveleti jog kell. Több autós riportnál minden érintett autóhoz szükséges az adott művelet joga; részleges riportot a szerver nem ad vissza. Az előzményeknél a régebbi változatok autóit is ellenőrzi. A járműolvasási, tankolási vagy rendszerszintű jog önmagában nem ad pénzügyi elszámolási jogot.

A közös védett admin automatikusan megkapja az új céges jogokat a számára kijelölt cégekben. A többi meglévő csoportot jogosult kezelő bővítheti. Az új demo adatgenerálás a sofőröknek saját rögzítést, a flottakezelőnek kezelést és jóváhagyást is ad.

## API

Alapútvonal: `/api/v1/fuel-settlements`. Minden kéréshez bejelentkezés és céges kontextus kell. A `userId` opcionális; alapértelmezése a belépett felhasználó kanonikus neve. A hónap `YYYY-MM-01`.

| Végpont | Funkció |
|---|---|
| `GET /options?month=...&userId=...` | Jogosult személyek, járművek és érvényes alapértékek |
| `GET /months/{month}?userId=...` | Mentett riport vagy üres piszkozat |
| `POST /months/{month}/preview` | `SettlementDraft` ellenőrzése, mentés nélkül |
| `PUT /months/{month}` | Verziózott piszkozatmentés |
| `POST /months/{month}/submit` | Hibátlan, lezárult havi piszkozat beküldése |
| `POST /months/{month}/approve` | Beküldött riport jóváhagyása |
| `POST /months/{month}/reopen` | Indokolt újranyitás |
| `GET /months/{month}/history` | Megőrzött változatok és állapotváltások |
| `GET /months/{month}/export` | Jóváhagyott HUF-riport CSV-je |
| `GET /months/{month}/sources/{vehicle}` | Eredeti XLSX, kezelési joggal |
| `PUT /policies/{month}` | Kezdőhónap szerinti céges szabály mentése |
| `POST /import/preview` | Multipart: `file`, `year` |
| `POST /import/draft` | Multipart: `file`, `year`, `rowId`, `userId`, `vehicleId`, `reason` |

A módosító kérések CSRF-védettek. Piszkozatmezők: `version`, `rules: {freeKm, firstBandKm, firstRate, secondRate}`, `lines: [{vehicleId, startKm, endKm, liters, privateKm, unitPrice, useRecordedFuel, priceSource}]`, opcionális `agreedAmount`, `agreementReason`, `reason`. Hiányzó mennyiséget `null` jelöl. Állapotváltás: `{version, reason}`.

A CSV mezői idézőjelezettek, a képletindításra alkalmas szövegek védettek. A teljes jóváhagyott havi összeg csak az első járműsorban szerepel, hogy több autó esetén ne lehessen véletlenül többször összegezni. Egyedi megállapodás esetén a részletek a normál számítást, a havi összeg az elfogadott díjat mutatja.

## Tárolás és naplózás

Migráció: `20261123105030_FuelSettlementAccounting`.

| Tábla | Kulcs és tartalom |
|---|---|
| `fuel_settlement_policies` | `TenantId, Month`; JSONB-szabályok, konkurenciaverzió |
| `fuel_settlements` | `TenantId, UserId, Month`; JSONB-bemenet és számítás, állapot, verzió, módosító/időpont, jóváhagyó/időpont |
| `fuel_settlement_vehicles` | `TenantId, UserId, Month, VehicleId`; összetett céges jármű- és riport-FK, opcionális eredeti XLSX `bytea` és változatlan forrásmetaadat `jsonb` |
| `fuel_settlement_history` | `TenantId, UserId, Month, Version`; teljes JSONB-pillanatfelvétel, állapot, szereplő, időpont és indok |

A mentés, járműhivatkozások, forrásfájl, állapotváltás és napló egy céges tranzakció része. Mind a négy táblán kényszerített PostgreSQL RLS működik. A történeti változatok adatbázisszinten csak hozzáfűzhetők; a forrásfájl és metaadata változatlan, a riport személye/hónapja nem írható át. A jóváhagyott pillanatfelvétel rendszámát is megőrzi a rendszer.

A céges változásnapló járművenként tárol eseményt; nem kerül bele más telephelyű autókat tartalmazó teljes riport. A teljes pénzügyi előzményt csak az összes érintett autóhoz megfelelő elszámolási joggal lehet lekérni. A meglévő PostgreSQL-mentés az új táblákat és forrásfájlokat is tartalmazza.

## Ellenőrzések

Automatizált ellenőrzés fedi az Excel-példa visszaszámítását, a díjsávhatárokat, több autó egyszeri keretét, az üres/nulla különbségét, a tört kilométereket, hiányos adatok tiltását, saját és más felhasználó elérését, céges/telephelyes elkülönítést, a jóváhagyási folyamatot, verzióütközést, fagyasztott adatokat, importelőnézetet, ismételt import tiltását, eredeti fájl megőrzését és a csak hozzáfűzhető adatbázis-előzményt.
