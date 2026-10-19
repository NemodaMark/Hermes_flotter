# HERMES backend base

Az ASP.NET Core 10 + Entity Framework Core + PostgreSQL 18 backend jelenlegi kiinduló állapota. A további fejlesztés elsődleges területe az üzleti működés, az API, az adatmodell és a többcéges jogosultságkezelés.

## Az alapban működő funkciók

- Regisztráció, bejelentkezés, munkamenet-lekérdezés és kijelentkezés ASP.NET Core Identity használatával.
- Hash-elt jelszavak, HttpOnly munkamenetsüti, CSRF-védelem, belépési korlátozás és ideiglenes fiókzárolás.
- Saját cégek lekérdezése és új cég létrehozása; a létrehozó Owner-tagsága a céggel közös tranzakcióban készül el.
- Egy felhasználó több cég tagja lehet, cégenként Owner, FleetManager vagy Viewer szerepkörrel.
- Céges járművek listázása, egyedi lekérése és felvétele, cégenként egyedi rendszámmal.
- Tagságellenőrzés minden céges járműkérésnél, EF Core tenantszűrés és PostgreSQL FORCE ROW LEVEL SECURITY a járműtáblán.
- Külön migrációs és alkalmazás-adatbázisszerepkör, készenléti végpont és PostgreSQL-es integrációs tesztek.

A cégek és tagságok hozzáférését az API ellenőrzi; adatbázisszintű RLS jelenleg a járműtáblán van. Új céges üzleti táblánál a tenantkapcsolatokat és az adatbázisvédelmet is ki kell alakítani.

## Felépítés

| Projekt | Felelősség |
|---|---|
| `src/Hermes.Api` | HTTP-végpontok, hitelesítés, CSRF és tenantfeloldás |
| `src/Hermes.Application` | Alkalmazásszerződések, DTO-k és validáció |
| `src/Hermes.Domain` | Üzleti entitások és szerepkörök |
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

## További backendmunka

A járműkezelés következő bővítése lehet az adatok és állapot módosítása, archiválás, valamint szerveroldali keresés és lapozás. Ezt követhetik a sofőrök, a jármű-hozzárendelések, a karbantartások és a költségek. Minden új céges művelethez tartozzon szerveroldali validáció, szerepkör-ellenőrzés és cégek közötti hozzáférést kizáró teszt.

Az alap jelenleg nem tartalmaz e-mail-megerősítést, jelszó-visszaállítást, meghívásos tagságkezelést, előfizetést vagy a fenti új üzleti modulokat.
