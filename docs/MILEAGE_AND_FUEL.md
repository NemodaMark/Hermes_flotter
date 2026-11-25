# Tankolás és személyes havi km-elszámolás

Állapot: **2026. november 20.**

2026. november 23-tól a havi felület **Magánhasználati díj** része külön, verziózott pénzügyi elszámolást is kezel. A teljes km-keret és az ingyenes magánkeret külön marad. A díjszámítás, jóváhagyás, Excel-próbaimport és új jogosultságok leírása: [Havi üzemanyag-elszámolás](FUEL_SETTLEMENTS.md).

## Használat

Az autós kezdőlapon a **Tankolás** és a **Km rögzítése** közvetlen művelet. A jogosult felhasználó a **Foglalások** gombbal az autó meglévő foglalási naptárát nyitja meg; egy foglalás továbbra is legfeljebb hét naptári nap. A további járműrészek a **Továbbiak** menüben maradnak. Rögzítés és elszámolás közben a 3D bemutató megáll.

A **Km rögzítése → Havi elszámolás** nézetben, illetve a kezdőlap **Továbbiak → Havi km-elszámolás** menüjében lehet személyes riportot vezetni. Az elszámolás autótól függetlenül, **cégenként és személyenként** összesít. Így több autó használata ugyanabba a keretbe tartozik.

A felhasználói adatlapon az aktuális havi km-állás a kiválasztott céghez tartozik. A `mileage.record` joggal a saját, a `mileage.manage` joggal az adott cég másik felhasználójának elszámolása is megnyitható.

A felhasználó választhat:

- **Tételes rögzítés:** tankoláskor a szerver kiszámítja az elszámolható távolságot, a felhasználó csak a magánkilométert adja meg. Kilométeróra-állás rögzítésekor mindkét távolság megadható. A havi nézet utólagos tételeket is fogad, és automatikusan összesíti őket.
- **Havi összesítő:** havonta egy teljes futásteljesítmény- és magánkilométer-értéket ad meg. Ilyenkor a tankolás/óraállás felvitele nem ad új elszámolási tételt.

A választás következő hónapokra is alapértelmezés. Meglévő, lezáratlan hónapon külön módosítható. Módváltáskor a korábbi tételek megmaradnak, de **vagy a tételek összege, vagy a havi összesítő számít**. Nem adódnak össze. Tételes módra visszaváltás a megőrzött, érvényes tételekből újraszámol.

**Mindkét módnál le kell zárni a hónapot.** Nulla használatot külön meg kell erősíteni. A fordulónap a naptári hónap első napja, a cég időzónájában. A legrégebbi hiányzó zárás a kezdőlapon megjelenik. Az elszámolási kötelezettség az első beállított vagy ténylegesen használt hónaptól indul; nem keletkezik korlátlan visszamenőleges tartozás.

Tankoláskor a rendszer a jármű adott havi, a használóhoz köthető előző állásától számol. Hónapváltás, használóváltás, hiányzó kezdőállás vagy már elszámolt szakasz esetén a tankolás önállóan menthető. A hiányzó távolság az érintett hónapokban kézzel rögzíthető. A magánkilométer a teljes megtett távolság része.

## Havi keret és javítások

A `mileage.manage` joggal rendelkező kezelő a havi nézetben felhasználót választ, és a **Személyes havi km-keret beállítása** részen megadja a keretet. A céges és magánhasználat együtt számít. A túllépés látható figyelmeztetés; a tényleges futás rögzítése nem tiltható le miatta. A lezárt hónap megőrzi a záráskor érvényes keretet, későbbi keretváltozás vagy javítás után is.

A havi adatok és a tételek javíthatók, indoklással és verzióellenőrzéssel. Lezárt hónap tételének módosítása vagy érvénytelenítése újra megnyitja a hónapot; ismételt zárás szükséges. A korábbi adat és az indok a módosítási naplóban megmarad.

A jármű tényleges kilométeróra-előzménye továbbra is hozzáfűzött, adatbázisszinten nem átírható előzmény. A személyes elszámolás javítása ezt nem írja át. Tankolás javításakor a hozzá kapcsolt személyes km-elszámolást is külön kell javítani, ha az is hibás. Tankolás érvénytelenítése önmagában nem törli a már bevallott megtett utat.

## Tankolás és fogyasztás

A felületen kötelező a dátum, a kilométerállás és a liter. Az opcionális JPG/PNG-nyugtafotót a szerver újrakódolja, majd PostgreSQL-ben tárolja. A **Teletankoltam** jelölés a fogyasztásméréshez használható. A korábban megadott összegek, pénznemek és bizonylatszámok megmaradnak.

Két érvényes teletank között:

`fogyasztás = az első teletank UTÁN, a második teletankkal bezárólag betöltött összes liter / megtett km × 100`

A köztes részleges tankolások is számítanak. Az első teletank saját litermennyisége nem tartozik a következő mérési szakaszhoz. Az előző hónap utolsó teletankja is lehet kiindulás. A havi nézet a kiválasztott hónapban záródó teljes mérési szakaszok súlyozott átlagát mutatja, a mért kilométerrel együtt. Ez nem feltétlenül az adott hónapban megtett teljes út átlaga. Hiányos adat vagy csökkenő óraállás esetén nincs kitalált átlag; új teletankos kiindulás szükséges. Érvénytelenített tankolás nem számít.

Tankolást a **Tankolások → Módosítás** művelettel lehet javítani. Indok és aktuális verzió kötelező; az eredeti nyugtafájl, rögzítő és rögzítési idő változatlan. A listán látszik a rögzítő/módosító. A CSV-kivitel bizonylatszámot, teletankjelölést és mért fogyasztást is tartalmaz; a cellák idézőjelezettek és képletindítás ellen védettek.

## Jogosultságok és atomikus mentés

| Jog | Hatókör |
|---|---|
| `vehicles.odometer.create` | Óraállás felvitele az engedélyezett telephelyű járműhöz |
| `vehicles.fuel.read` | Tankolások, nyugta, fogyasztás, CSV olvasása a jog saját telephelyein |
| `vehicles.fuel.manage` | Tankolás rögzítése, indokolt javítása és érvénytelenítése a jog saját telephelyein |
| `mileage.record` | Saját személyes havi riport és magánkilométer az adott cégnél |
| `mileage.manage` | Céges felhasználók km-kerete és személyes havi riportjainak kezelése |
| `vehicles.bookings.read/create/manage` | A meglévő naptár és foglalási műveletek, saját telephelykorláttal |

A `mileage.*` személyes elszámolási jogok céges szintűek: nem adnak járműolvasási vagy -szerkesztési jogot. A személyes riport nem adja ki a forrásjármű belső azonosítóját. Más felhasználó riportjához kezelési jog kell; másik cégben lévő felhasználóhoz ez sem biztosít hozzáférést. A védett admin automatikusan megkapja az új céges jogokat a számára kijelölt cégekben, `system.manage` nélkül.

Óraállás/tankolás és opcionális elszámolási tétel egy tranzakcióban készül; hibás magánkilométer, visszavont jog, lezárt hónap vagy átfedés esetén az egész művelet visszagördül. A rögzített, járműhöz kapcsolt km-szakaszok másik tankolásból vagy óraállásból, másik felhasználó alatt sem számolhatók el másodszor ugyanabban a cégben. A kézi havi bevallás tartalmának helyessége továbbra is a bevalló felelőssége.

## API és adatbázis

A meglévő végpontok bővítése:

- `POST /api/v1/vehicles/{id}/odometer`: opcionális `usage: { month, totalKm, privateKm }`.
- `GET /api/v1/vehicles/{id}/fuel/mileage-preview?date=...&kilometers=...` → `{ totalKm }`, megbízható előző állás hiányában `null`. A jármű tankoláskezelési és a személyes elszámolási joga is szükséges.
- `POST /api/v1/vehicles/{id}/fuel` — `fueledOn`, `kilometers`, `liters`, opcionális `isFullTank`, `automaticMileage: { totalKm, privateKm }`. Mentéskor a szerver újraszámolja a távolságot. A JSON és a multipart `data` + `file` formátum, valamint a korábbi `usage` és pénzügyi mezők továbbra is használhatók.
- `PUT /api/v1/vehicles/{id}/fuel/{entry}` — `{ data, version, reason }`. A személyes km-tételt a havi elszámolásban lehet javítani.
- `GET /api/v1/mileage/accounts`, `PUT /api/v1/mileage/accounts/{userId}`: kezelői név/keret/verzió lista, illetve keretbeállítás.
- `GET /api/v1/mileage/months/current?userId=...` a cég időzónája szerinti aktuális hónap riportját adja a havi riport jogosultságaival.
- `GET/PUT /api/v1/mileage/months/{yyyy-MM-01}?userId=...`: saját vagy jogosultan kiválasztott havi riport, mentés/zárás.
- `PUT .../mode`: `{ mode: "Entries" | "Monthly", version }`.
- `POST .../entries`, `PUT .../entries/{id}`, `POST .../entries/{id}/void`: tétel felvitele, javítása és érvénytelenítése; `monthVersion` és javításkor tétel-`version` + `reason` kötelező.

A pontos szerződések: [MileageContracts.cs](../backend/src/Hermes.Application/MileageContracts.cs), [MileageEndpoints.cs](../backend/src/Hermes.Api/MileageEndpoints.cs), [MileageManagement.cs](../backend/src/Hermes.Infrastructure/MileageManagement.cs).

A `20261120115253_MonthlyMileageAndFuelCorrections` migráció három, RLS-sel védett táblát hoz létre:

| Tábla | Kulcs | Fontos adatok |
|---|---|---|
| `mileage_accounts` | TenantId + UserId | Mode, MonthlyLimitKm, FirstMonth, Version |
| `mileage_months` | TenantId + UserId + Month | Mode, TotalKm, PrivateKm, LimitKm, LimitCaptured, SubmittedAt, Version, UpdatedBy/At |
| `mileage_entries` | TenantId + Id | UserId, Month, VehicleId?, StartKilometers?/EndKilometers?, OccurredOn, TotalKm, PrivateKm, Source, SourceId?, Version, VoidedAt, RecordedBy/At, UpdatedBy/At |

A felhasználói kulcs továbbra is a kanonikus felhasználónév. `Month` mindig hónap első napja. Az összetett idegen kulcsok is céghez kötik a kapcsolatokat. A forráshivatkozás egyedi; adatbázistrigger védi a rögzítőt, eredeti időt és forrást, a km-szakasz végét és az előzmény törölhetetlenségét. Üzleti műveleteknél a céges zárolás és friss jogosultság-ellenőrzés az átfedést is sorosítja. Javítások a meglévő céges és rendszernaplóba kerülnek, PostgreSQL-adatok a meglévő mentési folyamat részét képezik.

A `vehicle_fuel_entries` új mezői: ReceiptNumber?, IsFullTank, Version, RecordedAt?, UpdatedAt?, UpdatedBy?. A régi sorok megmaradnak: Version=1, IsFullTank=false, ismeretlen eredeti dátum/bizonylatszám továbbra is NULL. API-kompatibilitás miatt régi importküldőknél a bizonylatszám opcionális, az új felületen kötelező. A korábbi CSV-importséma változatlanul működik; az új személyes havi riportokhoz ebben a kiadásban a fenti API használható.

## Helyi demó és ellenőrzés

Az új demótelepítés a sofőröknek tankolási, saját km-elszámolási és foglalási jogot ad a korábbi telephelykorlátokkal. A flottakezelő személyes km-kereteket is kezelhet. Meglévő, saját állapotfájllal rendelkező helyi Demo Flotta frissítése:

```powershell
# HERMES_SEED_ADMIN_PASSWORD a meglévő helyi rendszerkezelő jelszava.
node scripts/seed-demo-data.mjs --operations-only
```

Ez kizárólag az ismert, egyetlen demócéghez tartozó demócsoportokat bővíti; a meglevő jogokat és telephelyeket megtartja. Első alkalommal 2500 km-es mintakeretet állít az aktív, rögzítésre jogosult demófiókoknak; meglévő keretet nem ír felül. A megtekintő/felfüggesztett fiók nem kap új jogot. Nem készít fiktív tankolást vagy km-bevallást meglévő valós használat helyére.

Tesztkód: [backend integrációs esetek](../backend/tests/Hermes.Api.Tests/MileageAndFuelTests.cs), [frontend munkafolyamatok](../frontend/src/mileageFlows.test.tsx). Valódi PostgreSQL-en ellenőrzött cég- és személyelkülönítés, RLS, forrásvédelem, visszagörgetés, átfedés, verzióütközés, hónapzárás, módváltás, keretmegőrzés, bizonylatmegőrzés és fogyasztás.

2026. 11. 20-i ellenőrzés: 219 backend-integrációs teszt és 196 frontendteszt sikeres; lint és production build sikeres. A nagy 3D-eszközök tesztjeihez a teljes frontendfuttatás `--maxWorkers=2 --testTimeout=20000` paramétereket használt. A kezdeti 5 másodperces időkorlát néhány modellbetöltési tesztnél kevés volt. Böngészős ellenőrzés: 1440×900, 768×900, 390×844 és 867×400; tankolásbeküldés, havi nézet és a gyorsgombok elérése ellenőrizve, vízszintes kilógás és JavaScript-hiba nélkül. A meglévő helyi adatbázis mentés után migrálva, demósofőrrel az új API-k is kipróbálva.
