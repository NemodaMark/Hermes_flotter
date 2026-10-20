# HERMES

Több céget kiszolgáló flottakezelő SaaS: React + TypeScript frontend, ASP.NET Core 10 API és PostgreSQL 18.

## Elkészült funkciók

- Valódi regisztráció névvel, e-mail-címmel és jelszóval; sikeres regisztráció után automatikus belépés.
- Bejelentkezés, kijelentkezés és oldalfrissítést túlélő, sütialapú munkamenet.
- Első cég létrehozása a belépés után, majd további cégek létrehozása és cégváltás.
- Az új cég és a létrehozó induló jogosultságai egy tranzakcióban készülnek el.
- Cégenként elkülönített járműlista, keresés, állapotszűrés és járműfelvétel.
- Cégenként és felhasználónként kiosztható műveleti jogok, fix szerepkörök nélkül.
- Céges felhasználólista, meghívások, hozzáférések felfüggesztése és jogosultsági eseménynapló az API-ban.
- Egyszerű Felhasználók oldal céges meghívással, jogkiosztással, felfüggesztéssel/visszaállítással és meghívóelfogadással.
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

A szolgáltatások állapota, folyamatai és verziói a külön **[Windows rendszervezérlőben](desktop/README.md)** is láthatók, ahonnan egyenként vagy együtt újraindíthatók:

```powershell
./scripts/start-control-center.ps1 -CreateShortcut
```

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

Az e-mail-megerősítés, jelszó-visszaállítás, kétlépcsős hitelesítés és az e-mail-küldő integráció még külön fejlesztési lépés. A regisztráció jelenleg közvetlenül beléptet. A Felhasználók oldalon készített meghívási hivatkozást külön kell eljuttatni a címzettnek.

## Többcéges működés

- `identity_users`: a valódi felhasználói fiókok; egy fiók több cég tagja is lehet.
- `tenants`: ügyfélcégek, egyedi belső azonosítóval. A cégnév nem szolgál csatlakozási vagy belépési azonosítóként.
- `tenant_memberships`: a felhasználó cégtagsága, aktív állapota, tagsági verziója, csatlakozási és felfüggesztési ideje.
- `permission_definitions`: a támogatott műveleti jogok katalógusa.
- `tenant_membership_permissions`: közvetlen jogok a cég + felhasználó + jog összetett kulcson.
- `tenant_invitations`, `tenant_invitation_permissions`: e-mail-címhez kötött meghívások és a kiosztandó jogok; a token helyett annak SHA-256 hash-e kerül tárolásra.
- `access_audit_events`: a hozzáférés-változások kezdeményezője, célja, ideje és előtte/utána adatai.
- `vehicles`: `TenantId` + `Id` összetett kulcs és cégenként egyedi, normalizált rendszám.

A `POST /api/v1/tenants` a bejelentkezett felhasználónak hoz létre új céget és a jelenlegi katalógus összes jogával rendelkező induló tagságot. Nincs tulajdonosi szerepkör vagy mindenre érvényes jokerjog. Új műveleti jog későbbi hozzáadása külön migrációs/kiosztási döntést igényel a meglévő tagságoknál. A kliens nem választhat másik felhasználót vagy már létező céget a létrehozáshoz. Egy meglévő cégnév is önálló, új céget hoz létre.

A kliens `X-Tenant-Id` fejléccel választ munkaterületet. A backend minden céges kérésnél az adatbázisból ellenőrzi az aktív tagságot és annak jogait, majd műveletenként engedélyez. A jogok nem kerülnek a munkamenetsütibe; a visszavonás a következő kérésben érvényesül, új belépés nélkül. Egy már folyamatban lévő járműkérés befejeződhet. A hozzáférést módosító műveletek tranzakcióban, cégenkénti sorzár után újra ellenőrzik a kezdeményező aktuális jogait.

Az EF Core szűrője, a mentési ellenőrzés és a PostgreSQL `FORCE ROW LEVEL SECURITY` szabálya védi a járműveket, a közvetlen jogokat, a meghívásokat, azok jogait és az eseménynaplót. A PostgreSQL tenantbeállítása tranzakcióhoz kötött, ezért nem kerül át a következő felhasználóhoz a kapcsolatpoolban.

Az alkalmazás adatbázis-felhasználója nem tulajdonos, nem superuser, és nincs `BYPASSRLS` joga. Új céges üzleti tábláknál az RLS-t és a céges kapcsolati korlátokat is hozzá kell adni. A globális Identity-fiókok, cégek és tagságok lekérdezését az API kifejezett felhasználó-/cégfeltételei védik; ezek nem kaptak RLS-t, mert a belépéshez és a saját cégek kiválasztásához tenant nélkül is szükségesek.

Frissítéskor a korábbi cég- és járműadatok megmaradnak. A régi fejlesztői mintatagságokat az új fiókok nem öröklik meg; név vagy e-mail alapján nincs automatikus hozzáférés-átadás.

## Céges felhasználók és jogok

| Jog | Engedélyezett művelet |
|---|---|
| `vehicles.read` | Járműlista és egy jármű megtekintése |
| `vehicles.create` | Jármű felvétele |
| `members.read` | Az adott cég felhasználóinak listázása és megtekintése |
| `members.invite` | Meghívások létrehozása, listázása és visszavonása |
| `members.update` | Céges hozzáférés felfüggesztése és visszaállítása |
| `permissions.manage` | Céges tagok jogainak lekérése és módosítása |
| `audit.read` | Céges hozzáférési eseménynapló olvasása |

A jogok függetlenek: a járműfelvételi jog nem ad automatikusan listázási jogot. Ugyanannak a fióknak két cégnél teljesen eltérő jogai lehetnek. A jogosultságkezelő csak a saját aktuális jogai körén belül adhat és vonhat vissza jogot; saját magát sem emelheti ezen túl. Az utolsó aktív `permissions.manage` jogosultságú tag nem függeszthető fel, és nem veszítheti el ezt a jogot. Ezt párhuzamos kérések és több API-példány esetén is a PostgreSQL céges sorzára védi.

A felhasználókezelés cégtagságot kezel: egy felfüggesztés nem tiltja le a globális fiókot vagy más cégek hozzáféréseit. Visszaállításkor az összes visszaálló jogot ellenőrzi a kezdeményező jogaihoz képest. A taglistában az azonosító, név, e-mail, állapot, verzió, jogok és tagsági időpontok láthatók; jelszóhash, biztonsági token vagy Identity-bélyeg nem kerül a válaszba. A megjelenített név a saját `PUT /auth/profile` végponton módosítható; más tag globális profilját a cég kezelője nem írhatja át.

Egy tag jogainak felülírása: `PUT /api/v1/members/{userId}/permissions`, `X-Tenant-Id` és CSRF-fejléccel:

```json
{ "permissions": ["vehicles.read", "vehicles.create"], "version": 1 }
```

A `version` a tagság legutóbb lekért verziója. Sikeres módosításkor nő; elavult verzióra `409 stale_membership` érkezik. Felfüggesztéshez `PATCH /api/v1/members/{userId}/status`, törzs: `{ "isActive": false, "version": 2 }`. A státuszt kifejezetten meg kell adni. Az üres joglista szabályos; ismeretlen vagy ismételt jog nem adható.

Meghívás: `POST /api/v1/invitations`, törzs: `{ "email": "tag@example.com", "permissions": ["vehicles.read"] }`. Nem üres joglistához a `members.invite` mellett `permissions.manage` is szükséges. A válasz `acceptance` objektumát csak ekkor lehet megkapni, benne a `tenantId`, `invitationId`, `token` adatokkal. Ezeket bizalmasan kell átadni a címzettnek. A címzett a megfelelő e-mail-című fiókjával bejelentkezve ezt az objektumot küldi a `POST /api/v1/invitations/accept` végpontra; ehhez nem kell céges fejléc.

A meghívó 7 napig érvényes és egyszer használható. Elfogadáskor a meghívó küldőjének aktuális jogait is újra ellenőrzi a rendszer; lejárt, visszavont, felhasznált vagy időközben jogosulatlanná vált meghívás nem hoz létre tagságot. Meglévő vagy felfüggesztett tagság nem írható felül meghívással. A listázás és az eseménynapló nem ad vissza meghívási tokent vagy hash-t.

A webes felületen válassz céget, majd nyisd meg a **Felhasználók** menüt. Itt kereshetsz a tagok között, jogokat szerkeszthetsz, megerősítés után felfüggeszthetsz/visszaállíthatsz hozzáférést, valamint létrehozhatsz és visszavonhatsz meghívókat. A vezérlők a saját jogaidhoz igazodnak. Automatikus e-mail-küldés nincs: a létrehozáskor egyszer látható hivatkozást kézzel kell továbbítani. A címzett belépés vagy regisztráció után kifejezetten elfogadja a meghívót, és a felület a megfelelő céget választja ki. A token a hivatkozás fragmentjében marad, elfogadás/bezárás után pedig törlődik a címsorból. A részletes felületi működést a [frontend leírása](frontend/README.md) tartalmazza.

A listavégpontok `page` (1–10000) és `pageSize` (1–100, alapból 25) paramétert, a taglista `search` paramétert is elfogad; válaszuk `{ "items": [], "total": 0, "page": 1, "pageSize": 25 }`. A hozzáférések változásai ugyanabban a tranzakcióban kerülnek az eseménynaplóba, mint az adatváltozás.

## API

| Művelet | Végpont |
|---|---|
| CSRF-token kérése | `GET /api/v1/auth/csrf` |
| Regisztráció, automatikus belépéssel | `POST /api/v1/auth/register` |
| Bejelentkezés | `POST /api/v1/auth/login` |
| Aktuális felhasználó | `GET /api/v1/auth/session` |
| Saját megjelenített név módosítása | `PUT /api/v1/auth/profile` |
| Kijelentkezés | `POST /api/v1/auth/logout` |
| Saját cégtagságok | `GET /api/v1/tenants` |
| Új cég, induló jogosultságokkal | `POST /api/v1/tenants` |
| Jogkatalógus, bejelentkezve | `GET /api/v1/permissions` |
| Saját aktuális céges hozzáférés | `GET /api/v1/tenant/access` |
| Taglista / egy tag (`members.read`) | `GET /api/v1/members`, `GET /api/v1/members/{userId}` |
| Tag jogai (`permissions.manage`) | `GET /api/v1/members/{userId}/permissions` |
| Jogok felülírása (`permissions.manage`) | `PUT /api/v1/members/{userId}/permissions` |
| Tagság állapota (`members.update`) | `PATCH /api/v1/members/{userId}/status` |
| Meghívások (`members.invite`) | `POST /api/v1/invitations`, `GET /api/v1/invitations` |
| Meghívó visszavonása (`members.invite`) | `DELETE /api/v1/invitations/{id}` |
| Meghívó elfogadása, bejelentkezve | `POST /api/v1/invitations/accept` |
| Céges eseménynapló (`audit.read`) | `GET /api/v1/audit-events` |
| Céges járműlista | `GET /api/v1/vehicles` |
| Céges jármű lekérése | `GET /api/v1/vehicles/{id}` |
| Járműfelvétel (`vehicles.create`) | `POST /api/v1/vehicles` |
| Folyamat állapota / adatbázis és migrációk | `GET /health/live`, `GET /health/ready` |
| A ténylegesen futó backend buildje | `GET /health/version` |

A regisztráció törzse `displayName`, `email`, `password`; a belépésé `email`, `password`; a céglétrehozásé `name`. A járműfelvétel törzse `registration`, `make`, `model`.

A hibás adatok és CSRF-ellenőrzés `400`, a hiányzó munkamenet `401`, a hiányzó céges jogosultság `403`, a nem látható jármű `404`, az ismételt céges rendszám `409`, a túl sok belépési próbálkozás `429` választ eredményez.

## Projektstruktúra

```text
frontend/                       React + TypeScript + Vite
backend/
  src/Hermes.Api/                HTTP, fiókok, munkamenet, CSRF, tenantfeloldás
  src/Hermes.Application/        Szerződések, DTO-k, validáció
  src/Hermes.Domain/             Üzleti entitások és műveleti jogok
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

Alapértelmezett címe http://localhost:8080; másik címhez állítsd be a `HERMES_BASE_URL` változót. A script saját, véletlen hitelesítő adatokkal két tesztfiókot és két céget hoz létre, ezért fejlesztői vagy CI-környezeten futtasd. Ellenőrzi a meghívást, a közvetlen jogokat, az azonnali visszavonást és az eseménynaplót is. A tesztjelszavakat és a meghívótokeneket nem írja ki.

Új migráció a `backend` mappából:

```powershell
dotnet tool restore
dotnet ef migrations add MigrationName --project src/Hermes.Infrastructure --startup-project src/Hermes.Api
```

A kiszolgáló nem migrál automatikusan: a migrációs parancs `ConnectionStrings__Migrations`, az API `ConnectionStrings__Database` beállítást használ. A következő üzleti modulok a sofőrök, karbantartások, költségek és előfizetések kezelése.

A `20261020002000_TenantPermissions` migráció a korábbi `Owner` tagságokat a jelenlegi 7 jogra, a `FleetManager` tagságokat `vehicles.read` + `vehicles.create`, a `Viewer` tagságokat `vehicles.read` jogra fordítja. Minden átalakításról naplóbejegyzés készül, majd a régi `Role` oszlop megszűnik. A meglévő tagságok aktívak, verziójuk 1; az ismeretlen régi csatlakozási idő `null`. A szemcsés jogok veszteség nélkül nem alakíthatók vissza fix szerepkörökké, ezért a migráció `Down` iránya tiltott. Frissítés előtt készíts adatbázismentést; visszaállításhoz azt és a hozzá tartozó korábbi alkalmazásverziót használd. Migrálás előtt állítsd le a régi API-t, majd az új sémával az új buildet indítsd.
