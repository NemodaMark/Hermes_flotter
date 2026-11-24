# HERMES teljesítmény-visszamérés

A visszamérés a [korábbi audit](TELJESITMENY_AUDIT_2026-11-24.md) utáni `57f2b42` verzióból indult. Az API-k és a böngésző elkülönített helyi PostgreSQL-adatbázist használtak. A mérőgép Intel Core i5-12450H, 31,7 GiB RAM és NVIDIA RTX 2050 konfiguráció.

## Autós dashboard és 3D garázs

Az Autós nézet a rendszámot, az óraállást, a teendőket és a jogosultság szerinti műveleteket azonnal megjeleníti. A **3D garázs** gomb tölti be a jelenetet, a **Gyorsnézet** visszavisz a kezelőfelületre. Kikapcsolt WebGL mellett is megnyitható a tankolási és a kilométer-rögzítési űrlap.

Mobilon, érintéses eszközön vagy legfeljebb négy logikai processzort jelző böngészőben a 3D kisebb modelleket, 256×128-as HDR-világítást és kisebb renderelési felbontást használ. A 14 könnyített GLB összesen 40,91 MB helyett 14,38 MB. A részletes változatok is részei a kiadásnak, ami új kiadásonként összesen 14,51 MB-tal növeli a 3D-fájlok tárhelyigényét. Az eszköz a kiválasztott változatot tölti le. [Garázs és modellek betöltése](../frontend/src/VehicleStudio.tsx) · [Változatok előállítása](../scripts/prepare-compact-vehicle-models.mjs)

A táblázat profil és verzió szerint három friss böngészőprofil mediánját mutatja. A lassított profilok 4× CPU-lassítást, 10 Mbit/s letöltést és 80 ms hálózati késleltetést kaptak. A kész állapot a DEMO-002 modell és kameravezérlés megjelenése. A bemutató mód képkockáit 6 másodpercig figyeltem. A buildpárok azonos laptopon, váltott sorrendben futottak a 15 szálas API-próba alatt.

| Böngészőprofil | 3D kész előtte → utána | Bemutató mód előtte → utána | GLB és HDR együtt |
| --- | ---: | ---: | ---: |
| Asztali, RTX 2050 | 2,55 → 2,37 s | 60 → 60 fps | 2,39 → 2,39 MB |
| Lassított mobil, RTX 2050 | 4,90 → 2,94 s | 59,8 → 60 fps | 2,39 → 0,78 MB |
| Lassított, szoftveres WebGL | 7,22 → 3,02 s | 4,8 → 27,9 fps | 2,39 → 0,78 MB |

Mobilon a gyorsulás 40%, a GLB és HDR együtt 67%-kal kisebb. A leglassabb mért mobilnyitás 3,02 másodperc volt. A szoftveres profilban a képkockaközök p95-e 283,4 ms-ról 66,7 ms-ra csökkent. Az asztali idők tartományai átfedték egymást. A gyorsnézet mind a négy profilban nulla GLB-, HDR- és garázsmodul-kéréssel nyitotta meg a napi műveleteket. A lassított mobilon a gyorsmenü láthatóvá válásának mediánja 376 → 287 ms volt három váltott sorrendű próbában.

A nagyobb DEMO-005 teherautó külön, egyetlen lassított mobilpárban 11,61 → 4,28 s alatt jelent meg, 7,41 → 1,55 MB átvitel mellett. Itt további csökkentés szükséges a 3 másodperces célhoz.

Egy böngészőlapon 24 alkalommal nyitottam meg és zártam be a garázst. Az első futásban kilenc figyelmeztetés érkezett a túl sok aktív WebGL-kontextus miatt. A garázs és a parkoló bezárásakor a HERMES most felszabadítja a saját WebGL-kontextusát. Ugyanez a próba a javítással nulla figyelmeztetést adott.

## API és adatbázis

A 30 perces olvasási próba a 30 járműves demócég és a 300 járműves tesztcég adatait használta. A második cégben három telephelyen 3 600 óraállás, 3 600 tankolás és 3 600 foglalás szerepelt. A 15 párhuzamos kliens 450 ms szünetet hagyott a kérések között. A tesztben flottakezelői és telephelyre korlátozott fiókok is szerepeltek.

**52 557 kérésből 52 557 HTTP 200** érkezett, átlagosan 29,2 kérés másodpercenként. A medián 22,5 ms, a p95 242,7 ms, a p99 490,4 ms volt. Az API lefedte egyebek mellett az áttekintőt, a keresést, a járműadatlapot, a tankolást, a foglalásokat, az elszámolásokat, a dokumentumokat és az auditot. A legmagasabb végpontonkénti p95 a keresés 272 ms-os értéke volt.

A záró tíz perc mintáiban az API 217–232 MiB munkamemóriát használt. A PostgreSQL-ben 12–16 alkalmazási kapcsolat és csúcsban 11 egyszerre zárolásra váró művelet látszott. Az adatbázis holtpontszámlálója 0 maradt. A hosszú futás mellett rövidebb helyi tesztek és buildek is futottak.

### Rövid csúcsterhelés azonos adatkészleten

A teljes és a két logikai CPU-ra korlátozott API és PostgreSQL öt-öt, egyenként nyolcmásodperces szakaszban futott. A két sorozatban összesen 11 905 kérés érkezett vissza sikeresen. A rövid szakaszok a terhelés lépcsőit mutatják, az egyenletes terhelést a fenti 30 perces eredmény jellemzi.

| Párhuzamos kliens | Teljes CPU p95 | Két logikai CPU p95 | Kérés/s teljes → két CPU |
| --- | ---: | ---: | ---: |
| 1 | 20,8 ms | 14,6 ms | 85,7 → 117,2 |
| 15, 450 ms szünettel | 89,0 ms | 94,9 ms | 30,2 → 29,9 |
| 15, folyamatosan | 158,9 ms | 169,1 ms | 220,3 → 156,5 |
| 30, folyamatosan | 247,2 ms | 321,4 ms | 215,2 → 164,3 |
| 60, folyamatosan | 325,0 ms | 600,6 ms | 278,6 → 163,5 |

Két logikai CPU-val a szünetes, 15 klienses próba lényegében ugyanannyi kérést szolgált ki. Folyamatos 60 kliensnél a kapacitás 41%-kal alacsonyabb lett és a p99 368,1 → 683,4 ms-ra nőtt. Az egyklienses rövid próbák szórása és a gép háttérterhelése miatt az első sorból nem lehet trendet megállapítani. A 30 járműves próba 3 105 sikeres kérést adott.

A dashboard lekérdezésének szűkebb adatprojekciója külön kísérletet kapott. A két API-példány közös 100-as PostgreSQL-kapcsolatkerete megtelt, és a külön kísérletben 17 darab HTTP 500-as válasz érkezett `53300` SQLSTATE-tel. Ezért ebből a futásból a lekérdezés hatása nem számszerűsíthető. A jelenlegi kiadás a korábban ellenőrzött backend-lekérdezést használja.

## Tesztek és lefedettség

Az API tesztcsomag valódi PostgreSQL-lel futott. Többek között a külön céges és telephelyes jogokat, a hozzáférés visszavonását, az archiválást, a foglalási ütközést, a járműelőzményeket, a tankolást és elszámolást, a dokumentumokat, a partnereket és az auditot ellenőrzi.

| Ellenőrzés | Eredmény |
| --- | --- |
| API és PostgreSQL | 234 sikeres teszt |
| Frontend és 3D-modellek | 243 sikeres teszt 27 fájlban |
| Asztali Rendszervezérlő | 16 sikeres teszt, hibamentes Release build |
| Windows telepítő a kiinduló verzión | A demo telepítése és ismételt futtatása, parancsikon, jogosultsági minta és az adatmegőrzési ellenőrzés sikeres |
| Frontend V8-lefedettség | 74,4% kódsor, 69,3% elágazás |
| Backend kódsorlefedettség a generált kód és migrációk nélkül | API 88,5%, Infrastructure 94,6% |
| Build, lint, shell szkriptek | Frontend Release build, lint, 12 Bash-szkript szintaxisa és ShellCheck sikeres |

A buildelt felületen az asztali, lassított mobil, szoftveres WebGL és WebGL nélküli próba megnyitotta a kezelőfelületeket. Külön ellenőriztem a jegyzet mozgatását és átméretezését egérrel, a mentett pozíció visszatöltését, az alapállapot visszaállítását, a foglalás mentését és lemondását, az engedélyezett és tiltott telephelyi elérést, valamint a valódi PDF-feltöltést és előnézetet. A járműmodellek célzott tesztje ellenőrzi a színezhető felületeket, az üvegeket, a talajhoz igazítást és a 3D-jelölők láthatóságát is. [Böngészőteszt](../scripts/tests/smoke-browser.mjs) · [Modelltesztek](../frontend/src/vehicleBodyModels.test.ts)

## Következő mérések

1. **Valódi gyenge eszköz.** Mérendő az első 3D-megnyitás és a parkoló egy integrált GPU-s gépen, valamint egy fizikai Android-eszközön. A mostani mobilprofil az RTX 2050-et használta, a szoftveres profil SwiftShadert. Különösen a nagy teherautó-modellek és a 3D-kód első betöltése profitálhat további csökkentésből.
2. **Több API-példány kapcsolatai.** A két párhuzamos API-példánnyal végzett kísérletben a közös PostgreSQL-kapcsolatkeret telítődött. A példányonkénti Npgsql-keretet és a PostgreSQL-maximumot együtt kell mérni. A 100 kapcsolatból a szolgáltatások és az adminisztráció is foglal helyet.
3. **Célzott UI regresszió.** A parkolót működő böngészőben ellenőriztem. A V8 egységteszt-lefedettségében a `FleetParking.tsx` 0%, a `DashboardGrid.tsx` 40,0%, a `VehicleOperations.tsx` 42,7% kódsorlefedettséget ért el. A parkoló hibakezelése, a dashboard mozgatás és átméretezés, valamint a járműműveletek sikertelen mentései ezek alapján jó következő tesztcélok.

A Debian/TeamCity telepítés szkriptjeit ezen a Windows-gépen statikusan ellenőriztem. Az Entra- és e-mail-műveletek a tesztkonfigurációval futottak. Az éles szolgáltatói környezet és a fizikai gyenge hardver külön mérést igényel.

## Megismétlés

- A böngészős próbához előbb a HERMES demo járműveket és foglalásokat kell betölteni az elkülönített példányra. A `HERMES_BROWSER_ADMIN` és a `HERMES_BROWSER_ACCOUNTS` a helyi tesztfiókok fájljára mutat. A `HERMES_BROWSER_URLS` vesszővel elválasztva kaphatja az eredeti és a módosított build címét. A `HERMES_BROWSER_SAMPLES=3` három ismétlést állít be. A `node scripts/tests/smoke-browser.mjs --garage` a 3D megnyitását és a képkockákat méri. A kapcsoló nélküli futás a munkafolyamatokat ellenőrzi. A Playwright és a Chromium külön telepíthető. A `HERMES_PLAYWRIGHT_MODULE` és a `HERMES_BROWSER_BINARY` külső telepítést is megadhat.
- Az eredeti 30 járműves demót a [terhelési adatkészlet](../scripts/tests/benchmark-fleet.sql) bővíti 300 tesztjárműves céggel, 12 havi óraállással, tankolással és foglalással. A [mérőprogram](../scripts/tests/benchmark-api.mjs) a tesztpéldány címét és belépési fájlját a `HERMES_BENCHMARK_URL` és `HERMES_BENCHMARK_ACCOUNTS` változókból kapja. A kétcéges tartós futás parancsa `node scripts/tests/benchmark-api.mjs --large --steady` a `HERMES_BENCHMARK_SECONDS=1800` beállítással.
