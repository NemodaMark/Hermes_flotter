# HERMES

Több céget kiszolgáló flottakezelő SaaS: React + TypeScript frontend, ASP.NET Core 10 API és PostgreSQL 18.

## Elkészült funkciók

- Valódi regisztráció névvel, e-mail-címmel és jelszóval; sikeres regisztráció után automatikus belépés.
- Bejelentkezés, kijelentkezés és oldalfrissítést túlélő, sütialapú munkamenet.
- Első cég létrehozása a belépés után, majd további cégek létrehozása és cégváltás.
- Az új cég és a létrehozó tulajdonosi tagsága egy tranzakcióban készül el.
- Cégenként elkülönített járműlista, keresés, állapotszűrés és járműfelvétel.
- Owner / FleetManager / Viewer jogosultságok és adatbázisszintű céges elkülönítés.
- Migrációk, Docker Compose és GitHub Actions, valódi PostgreSQL-es integrációs tesztekkel.

## Indítás Dockerrel

Előfeltétel: Docker Engine / Docker Desktop és Docker Compose v2. A konténeres indításhoz külön Node.js vagy .NET SDK nem szükséges.

A projekt gyökerében, új klónozás után egyszer:

```powershell
Copy-Item .env.example .env
```

Meglévő `.env` fájlt ne írj felül. A mintajelszavak helyi fejlesztésre valók; a `.env` nincs Gitben.

```powershell
docker compose up --build
```

- Alkalmazás: http://localhost:8080
- API: http://localhost:5080/api/v1
- Készenlét: http://localhost:5080/health/ready
- OpenAPI fejlesztéskor: http://localhost:5080/openapi/v1.json
- PostgreSQL: localhost:5432, adatbázis: `hermes`

Nyisd meg az alkalmazást, válaszd a **Regisztráció** lehetőséget, majd hozd létre a cégedet. Nincs előre létrehozott felhasználó vagy közös alapértelmezett belépési jelszó.

A Compose inicializálja a PostgreSQL-szerepköröket, külön folyamattal lefuttatja a migrációkat, majd indítja az API-t. Az API a korlátozott `hermes_app`, a migráció a `hermes_migrator` szerepkört használja. Az adatbázis a `postgres-data`, a munkamenetek védelméhez használt kulcsok a `data-protection-keys` kötetben maradnak meg.

Leállítás az adatok megtartásával:

```powershell
docker compose down
```

A PostgreSQL-jelszavak csak az üres kötet első inicializálásakor jönnek létre. Meglévő adatbázisnál a `.env` átírása önmagában nem módosítja a jelszavakat.

## Helyi frontend- és backendfejlesztés

Előfeltételek: Node.js 22.20 vagy újabb támogatott verzió, .NET 10 SDK és elérhető PostgreSQL 18.

```powershell
docker compose up -d --wait db
./scripts/dev-backend.ps1 -Migrate
./scripts/dev-backend.ps1
```

Másik terminálban:

```powershell
cd frontend
npm ci
npm run dev
```

Frontend: http://localhost:5173. Az `/api` és `/health` kéréseket a Vite a http://127.0.0.1:5080 címre továbbítja. A böngésző azonos eredetű API-kéréseket használ, ezért nincs szükség általánosan engedélyezett CORS-ra.

A backendindító script a gyökér `.env` fájljából olvassa a helyi adatbázis-portot és jelszavakat. Másik PostgreSQL-porthoz például:

```powershell
./scripts/dev-backend.ps1 -Migrate -DatabasePort 55432
./scripts/dev-backend.ps1 -DatabasePort 55432
```

A script először a PATH-on lévő .NET 10 SDK-t használja; ezen a gépen a `~/.codex/tools/hermes/dotnet` felhasználói SDK-t is felismeri. A korábban előkészített helyi PostgreSQL a `55432` portot használja. Másik API-címhez a frontend indítása előtt állítsd be az `API_PROXY_TARGET` környezeti változót.

## Fiókok és munkamenetek

A felhasználókat ASP.NET Core Identity tárolja. A jelszó helyett az Identity által előállított, sózott jelszóhash kerül az adatbázisba. Az e-mail-cím normalizált alakja adatbázisszinten is egyedi, így a párhuzamos regisztrációk sem hoznak létre két azonos fiókot.

- A jelszó 12–128 karakteres, nem lehet üres vagy kizárólag szóköz.
- A munkamenet `HttpOnly`, `SameSite=Lax` sütit használ; a frontend nem tárol belépési tokent a localStorage-ban.
- A süti élettartama 8 óra, csúszó lejárattal; nincs bekapcsolva böngészőbezáráson átívelő „Emlékezz rám” funkció.
- A regisztráció és a bejelentkezés percenként korlátozott; 5 hibás jelszó után a fiók 15 percre zárolódik. A korlátot a `Security:AccountPermitLimit` beállítás szabályozza.
- A munkamenet állapotát a frontend induláskor és időszakosan ellenőrzi. Kijelentkezéskor vagy lejárt munkamenetnél törli a privát adatokat a lekérdezési gyorsítótárból.
- A korábbi `X-Development-User` fejléc és a fejlesztői felhasználóválasztó megszűnt.

Minden módosító API-kéréshez CSRF-token kell. A kliens először lekéri a `GET /api/v1/auth/csrf` végpontot, majd a kapott `requestToken` értéket az `X-CSRF-TOKEN` fejlécben küldi, a sütikkel együtt. Sikeres regisztráció, belépés vagy kijelentkezés után új tokent kell kérni, mert a token az aktuális identitáshoz is kötődik. Ezt a frontend API-kliense automatikusan kezeli.

Éles környezetben a sütik kizárólag HTTPS-en használhatók. A Docker Compose helyi fejlesztésre `Development` környezetet állít be. Éles kiadásnál HTTPS-t, tartós és megfelelően védett Data Protection-kulcstárat, valamint a megbízható fordított proxyhoz illeszkedő továbbított fejléc- és kéréskorlátozás-beállításokat kell használni. Több API-példánynak közös kulcstár kell.

Az e-mail-megerősítés, jelszó-visszaállítás, meghívás és kétlépcsős hitelesítés felülete, valamint az e-mail-küldő integráció még külön fejlesztési lépés. A regisztráció jelenleg közvetlenül beléptet.

## Többcéges működés

- `identity_users`: a valódi felhasználói fiókok; egy fiók több cég tagja is lehet.
- `tenants`: ügyfélcégek, egyedi belső azonosítóval. A cégnév nem szolgál csatlakozási vagy belépési azonosítóként.
- `tenant_memberships`: az Identity-felhasználó `sub` azonosítója és cégenkénti szerepköre.
- `vehicles`: `TenantId` + `Id` összetett kulcs és cégenként egyedi, normalizált rendszám.

A `POST /api/v1/tenants` csak a bejelentkezett felhasználónak hoz létre új céget és Owner-tagságot. A kliens nem adhatja meg, kinek készüljön a tagság, milyen szerepkörrel vagy melyik már létező céghez. Egy meglévő cég nevének megadása is önálló, új céget hoz létre.

A kliens `X-Tenant-Id` fejléccel választ munkaterületet. A backend minden céges kérésnél ellenőrzi a felhasználó tagságát. Az EF Core szűrője, a mentési ellenőrzés és a PostgreSQL `FORCE ROW LEVEL SECURITY` szabálya egyaránt védi a járműadatokat. A PostgreSQL tenantbeállítása tranzakcióhoz kötött, ezért nem kerül át a következő felhasználóhoz a kapcsolatpoolban.

Az alkalmazás adatbázis-felhasználója nem tulajdonos, nem superuser, és nincs `BYPASSRLS` joga. Új céges üzleti tábláknál az RLS-t és a céges kapcsolati korlátokat is hozzá kell adni. A cégek és tagságok hozzáférését az API ellenőrzi; adatbázisszintű RLS jelenleg a járműtáblán van.

Frissítéskor a korábbi cég- és járműadatok megmaradnak. A régi fejlesztői mintatagságokat az új fiókok nem öröklik meg; név vagy e-mail alapján nincs automatikus hozzáférés-átadás.

## API

| Művelet | Végpont |
|---|---|
| CSRF-token kérése | `GET /api/v1/auth/csrf` |
| Regisztráció, automatikus belépéssel | `POST /api/v1/auth/register` |
| Bejelentkezés | `POST /api/v1/auth/login` |
| Aktuális felhasználó | `GET /api/v1/auth/session` |
| Kijelentkezés | `POST /api/v1/auth/logout` |
| Saját cégtagságok | `GET /api/v1/tenants` |
| Új cég, tulajdonosi tagsággal | `POST /api/v1/tenants` |
| Céges járműlista | `GET /api/v1/vehicles` |
| Céges jármű lekérése | `GET /api/v1/vehicles/{id}` |
| Járműfelvétel Owner / FleetManager szerepkörrel | `POST /api/v1/vehicles` |
| Folyamat állapota / adatbázis és migrációk | `GET /health/live`, `GET /health/ready` |

A regisztráció törzse `displayName`, `email`, `password`; a belépésé `email`, `password`; a céglétrehozásé `name`. A járműfelvétel törzse `registration`, `make`, `model`.

A hibás adatok és CSRF-ellenőrzés `400`, a hiányzó munkamenet `401`, a hiányzó céges jogosultság `403`, a nem látható jármű `404`, az ismételt céges rendszám `409`, a túl sok belépési próbálkozás `429` választ eredményez.

## Projektstruktúra

```text
frontend/                       React + TypeScript + Vite
backend/
  src/Hermes.Api/                HTTP, fiókok, munkamenet, CSRF, tenantfeloldás
  src/Hermes.Application/        Szerződések, DTO-k, validáció
  src/Hermes.Domain/             Üzleti entitások és szerepkörök
  src/Hermes.Infrastructure/     Identity, PostgreSQL, EF Core, migrációk
  tests/Hermes.Api.Tests/        Valódi PostgreSQL-es integrációs tesztek
infra/postgres/                 Adatbázis-szerepkörök inicializálása
scripts/dev-backend.ps1         Backendindítás és migráció
scripts/smoke-auth.mjs          Teljes HTTP-s fiók- és cégfolyamat ellenőrzése
.github/workflows/ci.yml        Frontend, backend és konténeres integráció
```

## Ellenőrzés és migráció

```powershell
cd frontend
npm test
npm run build
cd ../backend
dotnet test Hermes.slnx -c Release
```

A backendtesztek Testcontainers segítségével indítanak PostgreSQL 18-at. Docker nélküli alternatíva a `HERMES_TEST_ADMIN_CONNECTION` változó egy elkülönített helyi teszt-PostgreSQL adminisztrátori kapcsolatával. A teszt véletlen nevű adatbázist és saját szerepköröket hoz létre, majd ezeket törli; a fejlesztői `hermes` adatbázist nem módosítja.

Az elindított teljes alkalmazás gyors ellenőrzése:

```powershell
node scripts/smoke-auth.mjs
```

Alapértelmezett címe http://localhost:8080; másik címhez állítsd be a `HERMES_BASE_URL` változót. A script saját, véletlen hitelesítő adatokkal tesztfiókot és két céget hoz létre, ezért fejlesztői vagy CI-környezeten futtasd. A tesztjelszót nem írja ki.

Új migráció a `backend` mappából:

```powershell
dotnet tool restore
dotnet ef migrations add MigrationName --project src/Hermes.Infrastructure --startup-project src/Hermes.Api
```

A kiszolgáló nem migrál automatikusan: a migrációs parancs `ConnectionStrings__Migrations`, az API `ConnectionStrings__Database` beállítást használ. A következő üzleti modulok a sofőrök, karbantartások, költségek és előfizetések kezelése.
