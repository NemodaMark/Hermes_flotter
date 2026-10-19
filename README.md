# HERMES

Több céget kiszolgáló flottakezelő SaaS projektalap: React + TypeScript frontend, ASP.NET Core 10 API és PostgreSQL 18.

## Mi működik már?

- Céglista az aktuális felhasználó cégtagságai alapján, cégváltás.
- Cégenként elkülönített járműlista, keresés és állapotszűrés.
- Új jármű rögzítése tulajdonosi vagy flottakezelői szerepkörrel.
- Csak olvasási hozzáférés megtekintői szerepkörrel.
- EF Core migráció, cégenként egyedi rendszám, PostgreSQL Row-Level Security.
- Fejlesztői mintaadatok két céghez és két felhasználóhoz.
- Automatizált tesztek és GitHub Actions ellenőrzések.

Ez fejlesztői projektalap. Az éles bejelentkezési felület, regisztráció, meghívások, előfizetés, auditnapló, szerviz- és költségmodul a következő fejlesztési lépések.

## Gyors indítás Dockerrel

Előfeltétel: működő Docker Engine / Docker Desktop és Docker Compose v2. A konténeres indításhoz a gépre külön Node.js vagy .NET SDK nem szükséges.

A projekt gyökerében, PowerShellből:

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Az első parancsot új klónozáskor egyszer futtasd; meglévő `.env` fájlt ne írj felül. Az ott szereplő jelszavak helyi fejlesztői minták. A `.env` Gitből kizárt fájl.

Elérhetőségek az alapértelmezett portokkal:

- Alkalmazás: http://localhost:8080
- API: http://localhost:5080/api/v1
- API-készenlét: http://localhost:5080/health/ready
- OpenAPI fejlesztéskor: http://localhost:5080/openapi/v1.json
- PostgreSQL: localhost:5432, adatbázis: `hermes`

A Compose először inicializálja a PostgreSQL-szerepköröket, majd külön migrációs folyamattal létrehozza az adatmodellt és a mintaadatokat. Az API kizárólag a korlátozott `hermes_app` adatbázis-felhasználóval fut. A PostgreSQL 18 adatai a `postgres-data` kötetben, a `/var/lib/postgresql` útvonal alatt maradnak meg.

Leállítás az adatok megtartásával:

```powershell
docker compose down
```

Az adatbázis-szerepkörök jelszavai csak az üres kötet első inicializálásakor jönnek létre; egy már használt `.env` jelszómódosítása önmagában nem módosítja az adatbázis jelszavait.

## Gyors frontend- és backendfejlesztés

Előfeltételek: Node.js 22.20 vagy újabb támogatott verzió, .NET 10 SDK, valamint elérhető PostgreSQL 18. Az SDK-verziócsaládot a `global.json` rögzíti.

Indítsd csak az adatbázist:

```powershell
docker compose up -d --wait db
```

Egy terminálban, a projekt gyökeréből:

```powershell
./scripts/dev-backend.ps1 -Migrate -Seed
./scripts/dev-backend.ps1
```

Másik terminálban:

```powershell
cd frontend
Copy-Item .env.example .env
npm ci
npm run dev
```

A frontend a http://localhost:5173 címen fut. A Vite az `/api` és `/health` kéréseket a http://127.0.0.1:5080 API-ra továbbítja. Így a böngésző azonos eredetű kéréseket használ. Másik API-címhez indítás előtt állítsd be az `API_PROXY_TARGET` változót.

A backendindító script a gyökér `.env` fájljából olvassa a helyi adatbázis-portot és jelszavakat. Másik helyi PostgreSQL-porthoz például `./scripts/dev-backend.ps1 -DatabasePort 55432`. A script először a PATH-on lévő .NET 10 SDK-t keresi; ezen a gépen az előkészítés során telepített felhasználói SDK-t is felismeri a `~/.codex/tools/hermes/dotnet` helyen.

## Fejlesztői felhasználók

| Felhasználó | Duna Logisztika | Pannon Szerviz |
|---|---|---|
| Kovács Anna (`anna`) | Owner | FleetManager |
| Nagy Béla (`bela`) | Viewer | Nincs hozzáférés |

A fejlesztői frontend alján felhasználó váltható. Ez kizárólag minta-munkamenet, nem éles bejelentkezés.

Az API csak akkor fogadja el az `X-Development-User` fejlécet, ha az alkalmazáskörnyezet `Development` és az `Authentication:EnableDevelopmentAuthentication` igaz. Más környezetben ennek bekapcsolása leállítja az alkalmazás indulását. A frontend megfelelő kapcsolója a `VITE_ENABLE_DEVELOPMENT_AUTH` buildváltozó; a hozzáférést mindig a backend ellenőrzi.

## SaaS-adatelkülönítés

- `tenants`: az ügyfélcégek.
- `tenant_memberships`: a hitelesített felhasználó `sub` azonosítója és cégenkénti szerepköre. A beállított, megbízható JWT-kibocsátó az identitás névtere.
- `vehicles`: `TenantId` + `Id` összetett kulcs, valamint cégenként egyedi normalizált rendszám.
- A kliens `X-Tenant-Id` fejléccel választ céget. A middleware minden kérésnél ellenőrzi hozzá a hitelesített felhasználó cégtagságát.
- Az EF Core globális szűrője csak az aktuális cég járműveit adja vissza. A mentés külön ellenőrzi a rekord céges tulajdonosát.
- A PostgreSQL `FORCE ROW LEVEL SECURITY` szabálya tenantkontextus nélkül nem enged járműadatot olvasni vagy írni. A kapcsolatkorlát a tranzakcióhoz kötött `set_config(..., true)` beállítással működik, így nem marad a kapcsolatpoolban.
- Az alkalmazás adatbázis-szerepköre nem tulajdonos, nem superuser és nincs `BYPASSRLS` joga. A migrációt külön szerepkör végzi.
- A frontend járműlekérdezéseinek gyorsítótára felhasználóhoz és céghez kötött; a korábbi cég adatait nem használja helyettesítő adatként.

A cégek és tagságok hozzáférését az API ellenőrzi; jelenleg a járművek tábláján van adatbázisszintű RLS. További céges üzleti tábláknál ugyanezt a védelmet és a kapcsolatokban a `TenantId`-t is hozzá kell adni.

## Projektstruktúra

```text
frontend/                        React + TypeScript + Vite
backend/
  Hermes.slnx
  src/Hermes.Api/                 HTTP-végpontok, hitelesítés, tenantfeloldás
  src/Hermes.Application/         Használati szerződések, DTO-k, validáció
  src/Hermes.Domain/              Üzleti entitások és szerepkörök
  src/Hermes.Infrastructure/      PostgreSQL, EF Core, migrációk
  tests/Hermes.Api.Tests/         Valódi PostgreSQL-es integrációs tesztek
infra/postgres/                  Adatbázis-szerepkörök inicializálása
scripts/dev-backend.ps1          Helyi backendindítás és migráció
.github/workflows/ci.yml         Build, tesztek, Docker-indítás ellenőrzése
```

## API

| Művelet | Végpont | Feltétel |
|---|---|---|
| Cégtagságok listázása | `GET /api/v1/tenants` | Hitelesített felhasználó |
| Járművek listázása | `GET /api/v1/vehicles` | Hitelesítés és ellenőrzött cégtagság |
| Jármű lekérése | `GET /api/v1/vehicles/{id}` | Az aktuális cég járműve; más cégnél `404` |
| Jármű létrehozása | `POST /api/v1/vehicles` | Owner vagy FleetManager |
| Folyamat állapota | `GET /health/live` | Nyilvános |
| Adatbázis és migrációk állapota | `GET /health/ready` | Nyilvános, részletek nélkül |

Új jármű kéréstörzse:

```json
{ "registration": "AA-BB-123", "make": "Škoda", "model": "Octavia" }
```

A rendszámot a backend nagybetűsre és szóköz nélkülire normalizálja. Azonos cégen belüli ismétlés `409`, hiányzó vagy hibás adat `400`, hiányzó hitelesítés `401`, elégtelen jogosultság `403` választ ad. A kliens nem küldhet céges tulajdonost a jármű törzsadataiban: azt a backend rendeli hozzá.

## Tesztek és migrációk

```powershell
cd frontend
npm test
npm run build

cd ../backend
dotnet test Hermes.slnx -c Release
```

A backendtesztek alapértelmezetten Testcontainers segítségével indítanak PostgreSQL 18-at, ezért működő Docker szükséges. Alternatíva a `HERMES_TEST_ADMIN_CONNECTION` környezeti változó egy elkülönített helyi teszt-PostgreSQL adminisztrátori kapcsolatával. A teszt létrehoz, majd töröl egy véletlen nevű saját adatbázist és két saját szerepkört; a fejlesztői `hermes` adatbázist nem módosítja. Az adminisztrátori kapcsolatnak adatbázis- és szerepkör-létrehozási jogosultság kell, és kizárólag tesztkörnyezetre mutathat.

Új migráció létrehozása a `backend` mappából:

```powershell
dotnet tool restore
dotnet ef migrations add MigrationName --project src/Hermes.Infrastructure --startup-project src/Hermes.Api
```

A migrációkat az API kiszolgáló folyamata nem futtatja automatikusan. A migrációs parancs a `ConnectionStrings__Migrations`, az API a `ConnectionStrings__Database` beállítást használja.

## Éles környezet következő lépései

Az itt található Compose fejlesztői konfiguráció, mintaadatokkal. Éles kiadáshoz szükséges egy kiválasztott OIDC/JWT-szolgáltató és frontend belépési folyamat, HTTPS, titokkezelés, mentés-visszaállítás, naplózás és kéréskorlátozás. A backend már tud megbízható JWT-t ellenőrizni az `Authentication__Authority` és `Authentication__Audience` beállításokkal; a frontend belépési integrációja még nincs megvalósítva. A fejlesztői hitelesítést és frontend kapcsolóját élesben ki kell kapcsolni, mintaadatokat nem kell betölteni.
