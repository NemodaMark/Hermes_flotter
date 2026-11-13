# HERMES műszaki és üzemeltetési dokumentáció

Kiadás **2026. november 13.**, Europe/Budapest.

[Hermes_flotter](https://github.com/NemodaMark/Hermes_flotter) · [main](https://github.com/NemodaMark/Hermes_flotter/tree/main) · [kiadási előzmények](https://github.com/NemodaMark/Hermes_flotter/commits/main/)

## 1. Mire szolgál a HERMES

A rendszer több cég és telephely járműveit, munkatársait és partnereit kezeli. A webes alkalmazás a napi flottaüzemeltetés felülete. A Windows Control Center a helyi fejlesztői szolgáltatások indítására, figyelésére, naplóinak megtekintésére és verzióik összevetésére szolgál. A Debian kiszolgálón a konténereket és kiadásokat a telepítési eszközök kezelik. [Korábbi projektösszefoglaló](../PROJEKT_OSSZEFOGLALO.md) · [Windows Control Center](../desktop/README.md) · [Debian és TeamCity](../deploy/teamcity/README.md).

A flottafelmérés 19 kitöltéséből a legtöbben a szervizidőpont-emlékeztetőt és a műszaki vizsgáról szóló jelzést ítélték nagyon hasznosnak. A felmérésben a tankolási elszámolás és a digitális átadás is visszatérő igény volt. A 2026. novemberi fejlesztés ezért a meglévő járműadatokra épülő határidőkkel, átadási jegyzőkönyvekkel, tankolási nyilvántartással és naptárral bővíti az alkalmazást.

## 2. Fejlesztési mérföldkövek

| Dátum | Mérföldkő | Forrás |
|---|---|---|
| 2026. október 20. | Cégek, telephelyek, műveleti hozzáférés és a csoportok telephelykorlátai. | [739c7c5](https://github.com/NemodaMark/Hermes_flotter/commit/739c7c5), [beea100](https://github.com/NemodaMark/Hermes_flotter/commit/beea100) |
| 2026. október 20. | Járműnyilvántartás, partnerek, szerviz, lízing és járműokmányok. | [dad2c27](https://github.com/NemodaMark/Hermes_flotter/commit/dad2c27), [8ead2d7](https://github.com/NemodaMark/Hermes_flotter/commit/8ead2d7) |
| 2026. október 20. | HTTPS, restic-mentés és visszaállítási próba Debian 13-on. | [4c19071](https://github.com/NemodaMark/Hermes_flotter/commit/4c19071) |
| 2026. október 21–22. | Használói előzmények, egységes felület és demóflotta. | [24d2b71](https://github.com/NemodaMark/Hermes_flotter/commit/24d2b71), [e78dc38](https://github.com/NemodaMark/Hermes_flotter/commit/e78dc38) |
| 2026. október 24. | Csoportprioritású dashboard, interaktív karosszériamodellek és takarásvizsgálat. | [3c097f4](https://github.com/NemodaMark/Hermes_flotter/commit/3c097f4), [a5ab684](https://github.com/NemodaMark/Hermes_flotter/commit/a5ab684), [a630179](https://github.com/NemodaMark/Hermes_flotter/commit/a630179) |
| 2026. október 27. | E-mailes fiókfolyamatok, szerveroldali keresés és reszponzív felület. | [c997cbe](https://github.com/NemodaMark/Hermes_flotter/commit/c997cbe), [7f78f7c](https://github.com/NemodaMark/Hermes_flotter/commit/7f78f7c), [0c05228](https://github.com/NemodaMark/Hermes_flotter/commit/0c05228) |
| 2026. november 13. | Foglalások, digitális átadás, tankolási elszámolás, szervizidőpont és e-mail-emlékeztető, 3D stúdió, TeamCity-kiadás. | [Műveleti migráció](../backend/src/Hermes.Infrastructure/Migrations/20261113105709_FleetOperations.cs), [TeamCity beállítás](../.teamcity/settings.kts) |

## 3. Felépítés és technológiák

```text
Böngésző
  ├─ HTML, CSS, JS és helyi modellek ← Caddy → Nginx
  └─ /api/v1 és /health             ← Caddy → ASP.NET Core → PostgreSQL
                                                   └─ emlékeztető → SMTP
TeamCity → ellenőrzött Git-revízió → Debian kiadási parancs → Docker Compose
systemd → mentés és visszaállítási próba → restic repository
Windows Control Center → helyi PostgreSQL, API, Vite, health és Git
```

| Réteg | Technológia és döntés | Forrás |
|---|---|---|
| Felület | React 19 és TypeScript. Az adatlap, a naptár, a kereső, a táblák és az űrlapok ugyanazokat a Sera-alapú HERMES komponenseket használják. A TanStack Query tárolja és módosítás után újra lekéri a szerveradatokat. Vite csomagolja és fejlesztéskor az API felé továbbít. | [React](https://react.dev/learn), [TypeScript](https://www.typescriptlang.org/docs/), [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview), [Vite](https://vite.dev/guide/), [függőségek](../frontend/package.json) |
| Eszközök és média | IBM Plex Sans, Lucide, Three.js, PDF.js. A modellek és dokumentum-előnézetek külön csomagokban tölthetők. A PDF megjelenítése böngészőben, a képek ellenőrzése és újrakódolása a szerveren történik. | [Three.js](https://threejs.org/docs/), [PDF.js](https://mozilla.github.io/pdf.js/), [külső komponensek](../frontend/THIRD_PARTY_NOTICES.md) |
| API | .NET 10 / ASP.NET Core, C#, Minimal API, Identity, cookie és CSRF-védelem. A végpontok típusos kérés- és válaszszerződéseket használnak, üzleti hibánál Problem Details objektummal válaszolnak. | [ASP.NET Core Minimal API](https://learn.microsoft.com/aspnet/core/fundamentals/minimal-apis), [Identity](https://learn.microsoft.com/aspnet/core/security/authentication/identity), [indítás és szolgáltatások](../backend/src/Hermes.Api/Program.cs) |
| Adatkezelés | EF Core 10 és Npgsql, PostgreSQL 18. Az EF-modellek kezelik a kapcsolatokat és a séma migrációját. A PostgreSQL a céghatárhoz, az egyediséghez, a naplózott előzményekhez és a foglalási átfedéshez is adatbázis-korlátokat ad. | [EF Core](https://learn.microsoft.com/ef/core/), [Npgsql](https://www.npgsql.org/efcore/), [PostgreSQL RLS](https://www.postgresql.org/docs/18/ddl-rowsecurity.html), [verziók](../backend/Directory.Packages.props) |
| Feladatütemezés | ASP.NET Core hosted service és MailKit. A munkamenetkezeléstől független időzített keresés újrahasznosítja a meglévő biztonságos SMTP- és fejlesztői pickup-küldést. | [Hosted services](https://learn.microsoft.com/aspnet/core/fundamentals/host/hosted-services?view=aspnetcore-10.0), [MailKit](https://github.com/jstedfast/MailKit), [worker](../backend/src/Hermes.Api/FleetReminderWorker.cs) |
| Telepítés | Docker Compose szolgáltatásonkénti hálózattal, Caddy HTTPS, Nginx statikus fájlok, restic titkosított mentés, systemd időzítők. A TeamCity csak sikeresen ellenőrzött Git-revízióval hívja a szervert. | [Docker Compose](https://docs.docker.com/compose/), [Caddy HTTPS](https://caddyserver.com/docs/automatic-https), [restic](https://restic.readthedocs.io/), [TeamCity](https://www.jetbrains.com/help/teamcity/kotlin-dsl.html) |
| Windows asztali alkalmazás | WPF, XAML és .NET 10. A felület szolgáltatásállapotokat, verziókat, erőforrásadatokat és naplókat mutat. A Core projekt kezeli a folyamatokat, a PowerShell-indítást, a health ellenőrzést és a Git-összehasonlítást. | [WPF](https://learn.microsoft.com/dotnet/desktop/wpf/overview/), [Control Center Core](../desktop/src/Hermes.ControlCenter.Core/), [útmutató](../desktop/README.md) |
| Tesztek | xUnit és valódi PostgreSQL, Vitest és Testing Library, GitHub Actions és TeamCity. A migrációk, az üzleti szabályok és a böngészőkomponensek külön futtathatók. | [xUnit](https://xunit.net/), [Vitest](https://vitest.dev/guide/), [Testing Library](https://testing-library.com/docs/), [GitHub workflow](../.github/workflows/ci.yml) |

A backend a Domain, Application, Infrastructure és Api projektekre oszlik. Az entitások és a jogkatalógus a Domainben, az API felé átadott adatok az Applicationben, a PostgreSQL-tranzakciók az Infrastructure-ben, a végpontok és az e-mail háttérfeladata az Api-ban vannak. Az API egyetlen futtatható szolgáltatás. A build elkülöníti a PostgreSQL-séma tulajdonosát az alkalmazás által használt felhasználótól. [Backend útmutató](../backend/README.md) · [Szerződések](../backend/src/Hermes.Application/) · [Migrációk](../backend/src/Hermes.Infrastructure/Migrations/).

## 4. Hozzáférési modell és adatbiztonság

- Az azonosító felhasználónál a kanonikus felhasználónév, járműnél stabil UUID. A rendszám a felületen elsődleges, a korábbi rendszám kereshető.
- Az aktív tagsághoz közvetlen jogok és csoportjogok tartozhatnak. Minden céges és telephelyi hatókör a saját forráscsoportjához tartozik. Telephely nélküli járműhöz a megfelelő teljes céges műveleti jog kell.
- A védett admincsoport egyetlen definíció. A hozzárendelés cégeit felhasználónként adjuk meg. A `system.manage` ettől külön rendszerszintű jog.
- Egy járműkérés elején a munkamenet és a kiválasztott cég azonosítása után az API újraellenőrzi a műveleti jogot. A mentés a cég sorzárát, az EF-szűrőt és a PostgreSQL RLS-t együtt használja.
- A módosítási napló felhasználót, céget, műveletet és az adott művelethez tartozó változást tárol. A csatolmányok bájtjai a napló helyett a helyes szülőrekordhoz tartoznak.

[Jogkatalógus](../backend/src/Hermes.Domain/Permissions.cs) · [Hatókörök](../backend/src/Hermes.Domain/ResourceAccess.cs) · [Tranzakciók](../backend/src/Hermes.Infrastructure/TenantTransaction.cs) · [Projektüzleti szabályok](../AGENTS.md).

## 5. Foglalás és naptár

A jármű adatlapján a **Foglalások** fülön a kezelő a **Foglalható** kapcsolóval engedélyezi a funkciót. Az új és meglévő járművek alapértelmezésben kikapcsolt állapotúak. Foglalni aktív járműre lehet. A hónapnézet és a lista megmutatja a foglaló nevét és a teljes időszakot, akkor is, ha a foglalás átnyúlik két hónap között. A flottalistán a jogosult felhasználó látja a jelenlegi használót és a következő szabad napot az engedélyezett járműveknél.

A kezdő- és zárónap a cég naptárában egyaránt foglalt. A maximum hét egymást követő naptári nap, például hétfőtől vasárnapig. A PostgreSQL `CHECK` és GiST-kizárási korlát védi ezt az időtartamot és a jármű átfedésmentességét párhuzamos kérésnél is. A foglaló a saját jövőbeli vagy folyamatban lévő foglalását lemondhatja, a kezelő másét is. A lemondás naplózott, a foglalási rekord megmarad. A foglalhatóság kikapcsolása a már felvett foglalásokat megőrzi. A jármű tényleges használója átadáskor változik. [Foglalás kódja](../backend/src/Hermes.Infrastructure/FleetOperations.cs) · [btree_gist](https://www.postgresql.org/docs/18/btree-gist.html).

## 6. Átadás-átvétel és tankolás

Az **Átadás-átvétel** fülön a kezelő átvevőt választ a cég aktív tagjai közül, vagy visszaveszi a járművet a flottába. Az átadó az aktuális használóból, az időpont a szerver órájából jön. A mentés ellenőrzi a jármű verzióját és az előző kilométerállást. A használóváltás, az új km-előzmény, a jegyzőkönyv, az opcionális fotó és az audit együtt commitolódik. A jegyzőkönyv csak hozzáfűzhető. A művelethez `vehicles.users.assign` és `vehicles.odometer.create` szükséges a jármű telephelyén.

A **Tankolások** fül dátumot, kilométerállást, litert, összeget, pénznemet és opcionális nyugtafotót tárol. A havi összesítő pénznemenként külön összegez. A CSV magyarnyelvű fejlécet, pontosvesszős mezőelválasztást, tizedesvesszőt és UTF-8 BOM-ot használ. Érvénytelenítéshez indok kell. Az érvénytelen sor látszik a naplóban, az összesítő és a CSV az érvényes sorokból készül. A tankolási óraállás történeti adat.

A képek JPG vagy PNG formátumban, legfeljebb 5 MiB-os méretben tölthetők fel. Az API a jogosultság ellenőrzése után olvassa be a fájlt, kizárja az érvénytelen képeket, és a mentés előtt ismét ellenőrzi a hozzáférést. A megtekintés szintén jogosultsághoz kötött. [Végpontok](../backend/src/Hermes.Api/FleetOperationsEndpoints.cs) · [Képfeldolgozás](../backend/src/Hermes.Infrastructure/ImageProcessing.cs) · [Felületi komponensek](../frontend/src/VehicleOperations.tsx).

## 7. Szervizidőpontok és emlékeztetők

A Szerviz fülön járművenként egy egyeztetett időpont és megjegyzés rögzíthető. A megtekintéshez szervizolvasási, a módosításhoz szervizkezelési jog kell. A következő esedékesség dátuma és kilométerhatára továbbra is járműadat, a bejegyzések pedig lezajlott szervizek előzményei.

| Esemény | E-mail feltétele |
|---|---|
| Műszaki vizsga, biztosítás és dátum szerinti szerviz | Ma esedékes vagy legfeljebb 30 naptári nap van hátra. |
| Kilométer szerinti szerviz | Legfeljebb 1000 km van hátra, vagy a rögzített állás átlépte a határt. |
| Egyeztetett szerviz | A jövőbeli időpont legfeljebb hét napon belül lesz. |

Ötpercenként indulhat ellenőrzés. A címzett a jelenlegi használó vagy az adott műveletre jogosult kezelő, aktív tagsággal, igazolt e-mail-címmel és megfelelő telephelyi olvasási joggal. Szervizüzenethez szervizolvasási jog is kell. Az állapot jármű, esemény és címzett szerint tárolódik. A több példányból futó worker ugyanazt a foglalást nem kapja meg a 30 perces feldolgozási időn belül. SMTP-hibánál 30 perc után újra megkísérelhető. Ha az SMTP átvétele után, a siker adatbázisba írása előtt áll le a folyamat, előfordulhat ismételt e-mail. [Emlékeztető szabályok](../backend/src/Hermes.Infrastructure/FleetReminders.cs) · [Üzemeltetői SMTP-beállítás](../deploy/teamcity/README.md#e-mail-küldés-és-flottaemlékeztetők).

## 8. HTTP és PostgreSQL szerződések

A táblázatban az útvonalak előtagja `/api/v1/vehicles/{id}`. A céget az `X-Tenant-Id` fejléc adja meg. A GET hónapparaméter a hónap első napja az ISO-formátumban, például `2026-11-01`. Az írási végpontok érvényes CSRF-fejlécet kérnek.

| HTTP | Útvonal | Jogosultság |
|---|---|---|
| GET, POST | `/bookings` | `vehicles.read` és `vehicles.bookings.read`, illetve `vehicles.bookings.create` |
| GET, PUT | `/booking-settings` | `vehicles.bookings.manage` |
| DELETE | `/bookings/{booking}` | `vehicles.read` és saját foglalásnál create, kezelőként manage |
| GET, PUT, DELETE | `/service-appointment` | `vehicles.service.read` vagy az írásnál `vehicles.service.manage` |
| GET | `/fuel`, `/fuel/export`, `/fuel/{entry}/receipt` | `vehicles.fuel.read` |
| POST | `/fuel`, `/fuel/{entry}/void` | `vehicles.fuel.manage` |
| GET | `/handovers`, `/handovers/{entry}/photo` | `vehicles.read` |
| POST | `/handovers` | `vehicles.users.assign` és `vehicles.odometer.create` |

A tankolás és az átadás JSON-kérést vagy multipart űrlapot fogad. A multipart kérés `data` mezője JSON, az opcionális `file` mező a kép. Az adatszerkezeteket a [FleetOperationsContracts](../backend/src/Hermes.Application/FleetOperationsContracts.cs) írja le.

A `20261113105709_FleetOperations` migráció hat új táblája `vehicle_booking_settings`, `vehicle_bookings`, `vehicle_service_appointments`, `vehicle_fuel_entries`, `vehicle_handovers` és `vehicle_reminder_deliveries`. Mindegyik összetett céges idegen kulccsal hivatkozik a járműre és RLS-t használ. Az adatokat megőrző visszaállítás a kiadáshoz tartozó teljes mentést használja. [Adatmodell](../backend/src/Hermes.Infrastructure/FleetOperationsModel.cs) · [Migráció](../backend/src/Hermes.Infrastructure/Migrations/20261113105709_FleetOperations.cs).

## 9. Autós dashboard és modellcsomag

A GLB karosszériát a jármű kategóriája, a fényezést a tárolt szín adja. A jármű belső UUID-ja és rendszáma a látványtól független. Az SUV/terepjáró típus új Rally-Raid modellt, az ismeretlen karosszéria kompakt szedánt kapott. A többi karosszéria saját GLB-je fotóstúdió-megvilágítást, finomabb árnyékokat, jobb fényezést és igazított kameranézetet használ. A fókuszpontok a 3D geometriára illeszkednek. A takarásvizsgálat eltünteti a pontot, a vonalat és a címkét, amikor a modell kitakarja. A gyorsmenü WebGL nélkül is megnyitja az adatlapot.

A GLB-k karosszéria-illusztrációk. A típusonkénti gyártói pontossághoz gyártó/modell/év szerint azonosított és terjeszthető forrásmodellre van szükség. A modellek és a HDR helyben csomagoltak, forrásuk, licencük és ellenőrző összegük dokumentált. [3D stúdió](../frontend/src/VehicleStudio.tsx) · [Modellválasztás](../frontend/src/vehicleModels.ts) · [Licenc és SHA-256](../frontend/public/models/studio/LICENSE.md) · [Korábbi modellforrások](../frontend/public/models/vehicle-bodies/LICENSE.md).

## 10. Indítás, tesztelés és üzemeltetés

- Helyi fejlesztéshez a gyökérszintű Compose vagy a Windows Control Center indítható. A webes Vite-felület alapértelmezett portja 5173, a helyi API-é 5080. A frontendhez `npm ci`, `npm run lint`, `npm test` és `npm run build` futtatható. [Projektindítás](../README.md).
- Backendteszthez `dotnet test backend/Hermes.slnx -c Release`. Docker nélkül az elkülönített PostgreSQL adminisztrációs kapcsolata megadható a `HERMES_TEST_ADMIN_CONNECTION` környezeti változóban. A tesztek saját adatbázisokat és szerepköröket hoznak létre. [Teszt fixture](../backend/tests/Hermes.Api.Tests/FleetFixture.cs) · [Új üzleti tesztek](../backend/tests/Hermes.Api.Tests/FleetOperationsTests.cs).
- A napi mentés PostgreSQL-dumpot, csatolmányokat, TLS-állományokat, munkamenetkulcsokat és a megfelelő konténerképeket őrzi. A heti próba elkülönített adatbázist és API-t használ. A teljes helyreállítás üres célba történik. [Mentés és helyreállítás](../deploy/debian13/README.md).
- Az első telepítéshez a Debian telepítőt kell futtatni. Az ezután főágra kerülő kiadásokat a TeamCity teszteli és indítja. A TeamCity kulcsát, a hálózati elérést és az éles DNS-t az üzemeltető adja meg. [TeamCity telepítés](../deploy/teamcity/README.md).

**2026. november 13-i ellenőrzések.** A teljes backend tesztcsomag soros futtatásban 208, a frontend 179, a Control Center 16 sikeres tesztet adott. A végső adatkezelési változtatásokkal a célzott backendcsomag 20, a navigációt és 3D-t érintő célzott frontendcsomag 28 tesztje futott le. A Vite build, a lint, a ShellCheck és a Bash szintaxisellenőrzése sikeres. A 3D nézetet és a foglalási naptárt asztali és mobilméretben, böngészőben, tesztadatokkal ellenőriztük. A helyi PostgreSQL migráció mentést követően lefutott. A mentés elkülönített adatbázisba visszatölthető volt, a járműtábla 48 sora elérhető maradt. Az új telepítő teljes Debian/TeamCity futtatásához célkiszolgáló és beállított TeamCity projekt szükséges.

## 11. További fejlesztési pontok

- Céges/magán utak és a saját használati keret követése külön menetlevél-modullal. A tankolás és a teljes kilométerállás önmagában ehhez kevés.
- GPS vagy kártyaolvasó integráció, ha az eszköz, a szolgáltató, a munkáltatói folyamat és a hozzáférések rögzítettek.
- Céges szintű, járműveken átívelő költségriport a szerviz, lízing és tankolás adataiból.
- A flottalistán a következő szabad nap a foglalási naptárból származik. Fizikai átadás, szervizelés és foglalási naptár közötti automatikus jóváhagyást külön üzleti szabályokkal lehet bővíteni.
