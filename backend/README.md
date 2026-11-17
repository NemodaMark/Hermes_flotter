# HERMES backend base

Az ASP.NET Core 10 + Entity Framework Core + PostgreSQL 18 backend jelenlegi kiinduló állapota. A további fejlesztés elsődleges területe az üzleti működés, az API, az adatmodell és a többcéges jogosultságkezelés.

## Az alapban működő funkciók

- Regisztráció, bejelentkezés, munkamenet-lekérdezés és kijelentkezés ASP.NET Core Identity használatával.
- Az egyedi, kisbetűs felhasználónév maga a felhasználó belső elsődleges kulcsa (`Id = UserName`), a névtől/e-mailtől függetlenül; belépés felhasználónévvel vagy e-maillel. A meglévő UUID-s fiókok, hivatkozások és történeti naplók migrációját a [projekt leírása](../README.md#rendszerszintű-felhasználókezelés) részletezi.
- Hash-elt jelszavak, HttpOnly munkamenetsüti, CSRF-védelem, belépési korlátozás és ideiglenes fiókzárolás.
- Saját cégek lekérdezése és új cég létrehozása; a létrehozó konkrét induló jogai a céggel közös tranzakcióban készülnek el.
- Közvetlen jogkiosztás felhasználónként és cégenként, fix szerepkörök nélkül; alapértelmezett tiltás és friss jogellenőrzés minden céges kérésnél.
- Céges taglista, keresés, lapozás, jogmódosítás, felfüggesztés/visszaállítás, egyszer használható meghívások és eseménynapló.
- Cégenként sorzárral védett hozzáférés-módosítás, tagsági verzióellenőrzés, delegálási korlát és az utolsó jogosultságkezelő védelme.
- Saját megjelenített név módosítása; más tag globális fiókját a céges kezelő nem írhatja át.
- Külön, közvetlen `system.manage` jog: minden cég elérése, globális profilok és rendszerszintű jogok kezelése, kötelező jelszócsere elrendelése.
- Kötelező jelszócsere szerveroldali korlátozással, a régi munkamenetek érvénytelenítésével és a sikeres csere utáni feloldással.
- Központi, a runtime adatbázisszerepkörrel utólag nem módosítható/törölhető napló: módosító, érintett, időpont és a releváns régi/új értékek, jelszó nélkül.
- Céges járművek listázása, egyedi lekérése és felvétele, cégenként egyedi rendszámmal.
- Részletes járműadatlap, stabil UUID, rendszámelőzmények, műszaki és flottahasználati adatok, határidők, archiválás és visszaállítás.
- Teljes mezőkészlettel történő járműfelvitel, karosszériatípus, cégenként tanuló gyártó/modell-katalógus, opcionális 0–5 védett járműkép.
- Alap munkatársprofilok közös aktív cégtagsággal, saját profil és profilkép szerkesztése; elkülönített rendszerszintű fiókkezelés.
- Járműhasználó kijelölése külön `vehicles.users.assign` joggal, telephelykorláttal és nem törölhető használati előzménnyel; profilon csak a megtekintő által olvasható autók látszanak.
- Lapozott használati előzmény a `GET /api/v1/vehicles/{id}/assignee-history?page=1` végponton, `vehicles.read` joggal és a jármű telephelykorlátjával; időszakok, hozzárendelő és lezáró személy, kizárólag név/felhasználónév. Használóváltásnál az előző időszak vége és az új kezdete azonos időpont.
- Céges partnernyilvántartás több kategóriával és kapcsolattartóval; külön lízingszerződés- és szervizelőzmények, műveleti jogokkal és változásnaplóval.
- Aktív tagság és műveleti jog ellenőrzése, EF Core tenantszűrés és PostgreSQL FORCE ROW LEVEL SECURITY a járműveken és az új céges hozzáférési táblákon.
- Külön migrációs és alkalmazás-adatbázisszerepkör, készenléti végpont és PostgreSQL-es integrációs tesztek.

A globális Identity-fiókok, cégek és tagságok hozzáférését az API kifejezett felhasználó-/cégfeltételei ellenőrzik. RLS védi a járműveket, közvetlen jogokat, meghívásokat, meghívási jogokat és eseménynaplót. Új céges táblánál a tenantkapcsolatokat és az adatbázisvédelmet is ki kell alakítani.

## Felépítés

| Projekt | Felelősség |
|---|---|
| `src/Hermes.Api` | HTTP-végpontok, hitelesítés, CSRF és tenantfeloldás |
| `src/Hermes.Application` | Alkalmazásszerződések, DTO-k és validáció |
| `src/Hermes.Domain` | Üzleti entitások és jogkatalógus |
| `src/Hermes.Infrastructure` | Identity, EF Core, PostgreSQL, migrációk és adattárolás |
| `tests/Hermes.Api.Tests` | Fiókfolyamatok, jogosultságok és céges adatelkülönítés ellenőrzése |

## Helyi indítás

Előfeltétel: .NET 10 SDK, inicializált PostgreSQL 18 a `hermes_app` és `hermes_migrator` szerepkörökkel, valamint a projekt gyökerében kitöltött `.env`. Az adatbázis előkészítését és a teljes Docker Compose-indítást a [projekt README-je](../README.md) írja le.

A projekt gyökeréből, a szokásos adatbázisporttal:

```powershell
./scripts/dev-backend.ps1 -Migrate
./scripts/dev-backend.ps1
```

Ezen a fejlesztői gépen a már előkészített PostgreSQL a `55432` porton érhető el, ezért itt a két parancshoz add hozzá a `-DatabasePort 55432` kapcsolót. A migrációs parancs frissíti a sémát és kilép; az API indítása külön lépés.

- API: http://127.0.0.1:5080/api/v1
- Folyamat állapota: http://127.0.0.1:5080/health/live
- Adatbázis és migrációk készenléte: http://127.0.0.1:5080/health/ready
- OpenAPI fejlesztéskor: http://127.0.0.1:5080/openapi/v1.json

A backend a React felület nélkül is fejleszthető és tesztelhető. API-kliensből őrizd meg a sütiket, kérj tokent a `GET /api/v1/auth/csrf` végponton, majd a módosító kérésekhez küldd az `X-CSRF-TOKEN` fejlécet. Sikeres be- vagy kijelentkezés, illetve regisztráció után kérj friss tokent. Járműkéréseknél az `X-Tenant-Id` választja ki a céget; a jogosultságot a szerver ellenőrzi.

## Ellenőrzés

A `backend` mappából:

```powershell
dotnet test Hermes.slnx -c Release
```

A tesztek alapértelmezésben Dockerrel indítanak PostgreSQL-t. Docker nélküli futtatáshoz a `HERMES_TEST_ADMIN_CONNECTION` változóban elkülönített helyi teszt-PostgreSQL adminisztrátori kapcsolata adható meg; a tesztek saját ideiglenes adatbázist és szerepköröket használnak.

A teljes HTTP-s regisztrációs és céges folyamatot a [smoke teszt](../scripts/smoke-auth.mjs) ellenőrzi. Ez tesztadatokat hoz létre, ezért fejlesztői vagy CI-környezeten futtasd. A részletes végpontlista és az éles környezet beállításai a [projekt README-jében](../README.md) találhatók.

## Microsoft Entra ID-bejelentkezés

A HERMES egy Entra-címtár munkahelyi fiókjait fogadja. Az Entra admin centerben a regisztráció fióktípusa **Accounts in this organizational directory only** legyen. Az **Authentication** részen a **Web** platformhoz add meg a `https://<hermes-domain>/api/v1/auth/entra/callback` átirányítási címet. A meglévő regisztrációhoz is hozzáadható a Web platform. A bejelentkezéshez az `openid` és `profile` hatókör elegendő.

| API-beállítás | Telepítési környezeti változó | Érték |
|---|---|---|
| `Entra__Enabled` | `HERMES_ENTRA_ENABLED` | `true` |
| `Entra__TenantId` | `HERMES_ENTRA_TENANT_ID` | Directory (tenant) ID |
| `Entra__ClientId` | `HERMES_ENTRA_CLIENT_ID` | Application (client) ID |
| `Entra__ClientSecret` | `HERMES_ENTRA_CLIENT_SECRET` | A kliens titkos értéke a szerver védett konfigurációjában |

A hozzáférést az **Enterprise applications → HERMES → Properties → Assignment required? → Yes** beállítással korlátozd. A **Users and groups** alatt add hozzá az engedélyezett felhasználókat vagy csoportokat. A HERMES a saját céges és telephelyi műveleti jogait a sikeres Microsoft-belépés után ellenőrzi. [Microsoft Entra-hozzárendelések](https://learn.microsoft.com/en-us/entra/identity-platform/howto-restrict-your-app-to-a-set-of-users)

Helyi próbához a **Web** platform visszahívási címe `https://localhost:5174/api/v1/auth/entra/callback`. A fejlesztői API a `scripts/dev-backend.ps1` paranccsal, a HTTPS-es felület külön terminálból a `scripts/start-entra-frontend.ps1 -TrustCertificate` paranccsal indítható. Fejlesztéskor az `Entra:Enabled`, `Entra:TenantId`, `Entra:ClientId` és `Entra:ClientSecret` kulcsokat a Visual Studio **Manage User Secrets** menüpontjában add meg a `Hermes.Api` projekthez, majd indítsd újra az API-t. A kliens titkos értéke a helyi titoktárban vagy a szerver környezetében marad.

A fiókot a `system.manage` jogú felhasználó hozza létre a **Beállítások → Rendszerkezelés → Új felhasználó** menüpontban. Microsoft-fiókhoz az Entra **Users** alatt látható felhasználói **Object ID** kell. Ilyenkor a HERMES nem állít be helyi jelszót. Meglévő fiókot a **Saját profil → Fiókbiztonság** fülön lehet összekapcsolni a HERMES-jelszó megerősítésével. Az ASP.NET Identity a címtár- és objektumazonosító párját tárolja. A létrehozás, összekapcsolás és bontás naplózott. A kijelentkezés a HERMES munkamenetét zárja le.

[Microsoft Entra OIDC](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc), [ASP.NET Core OpenID Connect](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/configure-oidc-web-authentication?view=aspnetcore-10.0).

## Helyi mintaadatok

A demó betöltése után a `node scripts/seed-demo-data.mjs --bookings-only` parancs ugyanazzal a jelszóváltozóval foglalhatóvá teszi a DEMO-002, DEMO-003, DEMO-004 és DEMO-006 járművet. Nagy Anna és Kovács Bence között nyolc mintafoglalást oszt el. Az első futás napjához igazítja a dátumokat, és azonos adatokkal újrafuttatva megtartja a meglévő foglalásokat.

A projekt gyökeréből, futó fejlesztői API mellett, Node.js 22 vagy újabb verzióval:

```powershell
# A meglévő rendszerkezelő jelszavát környezeti változóként add meg.
$env:HERMES_SEED_ADMIN_PASSWORD = '<helyi rendszerkezelő jelszava>'
try { node scripts/seed-demo-data.mjs }
finally { Remove-Item Env:HERMES_SEED_ADMIN_PASSWORD }
```

Alapértelmezés: `http://127.0.0.1:5080`, felhasználó: `admin`; a `HERMES_BASE_URL` és `HERMES_SEED_ADMIN_USER` változókkal felülírható. A betöltő csak loopback címen, `Development` API-val és meglévő `system.manage` jogú fiókkal működik. Éles indulás és migráció nem tölt be demóadatot. Betöltés előtt készíts adatbázis-mentést.

A külön **Demo Flotta** céghez 3 telephely, 3 céges kapcsolattartó, 10 demófiók, 8 műveleti jogcsoport, 30 részletes jármű, 5 partner, 18 lízing-/bérleti szerződés és 60 szervizbejegyzés készül. Van teljes céges és telephelyre korlátozott hozzáférés, felfüggesztett tag, 2 telephely nélküli jármű, különböző állapotok, határidők, kilométer- és használati előzmények. A használói hozzárendelések időpontja a valódi betöltési idő, nincs visszadátumozva. A nevek, címek, e-mailek és azonosítók fiktívek; nincs e-mail-küldés vagy új adminfiók.

Minden módosítás a normál API-n keresztül, jogosultságellenőrzéssel és naplózással történik. Az egyedi, véletlen demójelszavak a Gitből kizárt `.local/demo-data/bejelentkezesek.json` fájlban találhatók. Ez és a `.local/demo-data/state.json` bizalmas helyi fájl, ne publikáld őket.

Az állapotfájl műveletenként rögzíti az előrehaladást. Megszakítás után ugyanazzal a fiókkal és API-val futtasd újra; befejezett betöltésnél már csak ellenőrzés történik. Állapotfájl nélkül meglévő azonos nevű céget vagy demófiókot a program nem használ fel és nem ír felül. A cég-/csoportlétrehozás közben elvesztett válasznál az ütközés miatt leállhat; ilyenkor őrizd meg az állapotfájlt és vizsgáld meg az utolsó műveletet, ne indíts második betöltést. Egyszerre egy betöltő fusson.

Kizárólagos ellenőrzés: `node scripts/seed-demo-data.mjs --verify-only` (ugyanazzal a jelszóváltozóval). Ez ellenőrzi a darabszámokat, a meglévő cégek és profilok megőrzését, a telephelykorlátokat, a más cégek kizárását és a felfüggesztett tagság tiltását. Későbbi kézi módosítások után a kezdeti pillanatképpel való eltérés szándékosan ellenőrzési hibát eredményezhet. A cég létrehozása a létrehozó profiljának verzióját a szokásos módon eggyel növeli; a korábbi profiladatokat és jogokat megőrzi.

## Csoportonkénti dashboard

A közös jogosultságcsoporthoz `DashboardMode` (`Overview` / `Vehicle`) és 0–1000 közötti `DashboardPriority` tartozik. A nagyobb prioritás dönt az aktuális cég aktív, tényleges csoporttagságai között. Az áttekintő eléréséhez `vehicles.overview.read` és `vehicles.read` egyaránt kell. E két jog mellett a csoportbeállítás dönti el a kezdőnézetet, egyezéskor vagy csoportbeállítás hiányában az áttekintő az alap. A védett céges admin jogcsomagja automatikusan tartalmazza az új jogosultságot.

A normál csoportfelvitel és -szerkesztés atomikusan fogadja a `dashboardMode` / `dashboardPriority` mezőket. Régebbi kliens hiányzó mezői szerkesztéskor megőrzik a korábbi beállítást. Külön beállítás: `PUT /api/v1/permission-groups/{id}/dashboard`, törzs: `{ "mode": "Vehicle", "priority": 100, "version": 3 }`. Minden érintett cégnél a meglévő csoportkezelési és delegálási ellenőrzések érvényesek; a közös védett admin kezdőnézetét kizárólag `system.manage` joggal lehet átállítani. Ez nem módosítja az admin nevét, automatikus jogkörét vagy hozzárendeléseit. A módosítás verzióellenőrzött és naplózott.

A `GET /api/v1/dashboard` a kezdőnézetet, az áttekintő elérhetőségét és a `vehicles.read` joggal olvasható járműveket adja vissza. A `GET /api/v1/dashboard/overview?site=all` mindkét jog telephelyi metszetére korlátozza a flottát. A `site` értéke `all`, `none` vagy telephely-azonosító lehet. A statisztika a cég időzónájában, az aktuális és az előző öt hónapra számol. Két mért óraállás különbségét a későbbi rögzítés hónapjához adja, a kezdő óraállás csak viszonyítási pont. A mérés nélküli hónap értéke `null`. A rangsor a legnagyobb összesített futásokat adja vissza.

## További backendmunka

A következő bővítés lehet a szerveroldali flottakeresés és lapozás, a sofőrök és hozzárendeléseik, a szerviztervezés és a teljes költségmodul. A szerződésekhez és munkalapokhoz védett fájlfeltöltés és http(s) dokumentumhivatkozás is használható; a végpontok és tárolási korlátok a projekt README dokumentumfeltöltési részében találhatók. Minden új céges művelethez tartozzon külön jog, szerveroldali validáció és cégek közötti hozzáférést kizáró teszt.

Az alap jelenleg nem tartalmaz e-mail-megerősítést, jelszó-visszaállítást, e-mail-küldő integrációt, előfizetés-kezelést. A meghívási token egyszer kerül vissza a létrehozó API-válaszban; a frontend ebből kézzel továbbítható csatlakozási hivatkozást készít. A [webes felhasználókezelő](../frontend/README.md#felhasználók-kezelése) ugyanezeket a végpontokat használja. A jogkatalógust, az API-végpontokat, a használati példákat és a régi szerepköröket átalakító migráció szabályait a [projekt README-je](../README.md#céges-felhasználók-és-jogok) tartalmazza.
