# HERMES

Több céget kiszolgáló flottakezelő SaaS: React + TypeScript frontend, ASP.NET Core 10 API és PostgreSQL 18.

## Elkészült funkciók

- Valódi regisztráció névvel, e-mail-címmel és jelszóval; sikeres regisztráció után automatikus belépés.
- Bejelentkezés, kijelentkezés és oldalfrissítést túlélő, sütialapú munkamenet.
- Első cég létrehozása a belépés után, majd további cégek létrehozása és cégváltás.
- Az új cég és a létrehozó induló jogosultságai egy tranzakcióban készülnek el.
- Cégenként elkülönített járműlista, keresés, állapotszűrés és járműfelvétel.
- Cégenként kiosztható egyedi műveleti jogok és szerkeszthető jogosultságcsoportok.
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
| `vehicles.update` | Rendszám, gyártó és modell szerkesztése |
| `vehicles.odometer.create` | Kilométerállás rögzítése, járműszerkesztési jog nélkül is |
| `permission-groups.manage` | Céges csoportok létrehozása, szerkesztése és törlése |
| `members.read` | Az adott cég felhasználóinak listázása és megtekintése |
| `members.invite` | Meghívások létrehozása, listázása és visszavonása |
| `members.update` | Céges hozzáférés felfüggesztése és visszaállítása |
| `permissions.manage` | Céges tagok jogainak lekérése és módosítása |
| `audit.read` | Céges hozzáférési eseménynapló olvasása |

A jogok függetlenek: a járműfelvételi jog nem ad automatikusan listázási jogot. Ugyanannak a fióknak két cégnél teljesen eltérő jogai lehetnek. A jogosultságkezelő csak a saját aktuális jogai körén belül adhat és vonhat vissza jogot; saját magát sem emelheti ezen túl. Az utolsó aktív `permissions.manage` jogosultságú tag nem függeszthető fel, és nem veszítheti el ezt a jogot. Ezt párhuzamos kérések és több API-példány esetén is a PostgreSQL céges sorzára védi.

A felhasználókezelés cégtagságot kezel: egy felfüggesztés nem tiltja le a globális fiókot vagy más cégek hozzáféréseit. Visszaállításkor az összes visszaálló jogot ellenőrzi a kezdeményező jogaihoz képest. A taglistában az azonosító, név, e-mail, állapot, verzió, jogok és tagsági időpontok láthatók; jelszóhash, biztonsági token vagy Identity-bélyeg nem kerül a válaszba. A megjelenített név a saját `PUT /auth/profile` végponton módosítható; más tag globális profilját a cég kezelője nem írhatja át.

Egy tag **egyedi** jogainak felülírása: `PUT /api/v1/members/{userId}/permissions`, `X-Tenant-Id` és CSRF-fejléccel:

```json
{ "permissions": ["vehicles.read", "vehicles.create"], "version": 1 }
```

A `version` a tagság legutóbb lekért verziója. Sikeres módosításkor nő; elavult verzióra `409 stale_membership` érkezik. Felfüggesztéshez `PATCH /api/v1/members/{userId}/status`, törzs: `{ "isActive": false, "version": 2 }`. A státuszt kifejezetten meg kell adni. Az üres joglista szabályos; ismeretlen vagy ismételt jog nem adható.

Meghívás: `POST /api/v1/invitations`, törzs: `{ "email": "tag@example.com", "permissions": ["vehicles.read"] }`. Nem üres joglistához a `members.invite` mellett `permissions.manage` is szükséges. A válasz `acceptance` objektumát csak ekkor lehet megkapni, benne a `tenantId`, `invitationId`, `token` adatokkal. Ezeket bizalmasan kell átadni a címzettnek. A címzett a megfelelő e-mail-című fiókjával bejelentkezve ezt az objektumot küldi a `POST /api/v1/invitations/accept` végpontra; ehhez nem kell céges fejléc.

A meghívó 7 napig érvényes és egyszer használható. Elfogadáskor a meghívó küldőjének aktuális jogait is újra ellenőrzi a rendszer; lejárt, visszavont, felhasznált vagy időközben jogosulatlanná vált meghívás nem hoz létre tagságot. Meglévő vagy felfüggesztett tagság nem írható felül meghívással. A listázás és az eseménynapló nem ad vissza meghívási tokent vagy hash-t.

A webes felületen válassz céget, majd nyisd meg a **Felhasználók** menüt. Itt kereshetsz a tagok között, jogokat szerkeszthetsz, megerősítés után felfüggeszthetsz/visszaállíthatsz hozzáférést, valamint létrehozhatsz és visszavonhatsz meghívókat. A vezérlők a saját jogaidhoz igazodnak. Automatikus e-mail-küldés nincs: a létrehozáskor egyszer látható hivatkozást kézzel kell továbbítani. A címzett belépés vagy regisztráció után kifejezetten elfogadja a meghívót, és a felület a megfelelő céget választja ki. A token a hivatkozás fragmentjében marad, elfogadás/bezárás után pedig törlődik a címsorból. A részletes felületi működést a [frontend leírása](frontend/README.md) tartalmazza.

A listavégpontok `page` (1–10000) és `pageSize` (1–100, alapból 25) paramétert, a taglista `search` paramétert is elfogad; válaszuk `{ "items": [], "total": 0, "page": 1, "pageSize": 25 }`. A hozzáférések változásai ugyanabban a tranzakcióban kerülnek az eseménynaplóba, mint az adatváltozás.

### Közös jogosultságcsoport-kezelés

A **Felhasználók → Jogosultságcsoportok** fül egy közös listát használ. Minden egyéni csoportnál név, egy vagy több cég és jogcsomag adható meg; nincs külön céges és többcéges csoporttípus. A munkaterületváltás nem szűri le ezt a listát egyetlen cégre. A felhasználó sorában a **Csoportok** gomb rendeli hozzá a csoportokat. A rendszerszintű kezelők ugyanezt a Rendszerkezelés oldalon is elérik, meglévő cégtagság nélküli fiókokhoz is.

Létrehozáshoz minden kijelölt cégnél `permission-groups.manage`, hozzárendeléshez `permissions.manage` szükséges. A kezelőnek a csoport teljes jogcsomagjával rendelkeznie kell minden érintett cégnél. Már kiosztott csoport szerkesztéséhez vagy törléséhez mindkét kezelési jog szükséges az összes korábbi és új cégnél. A létrehozó személye önmagában nem ad kezelési jogot. A lista csak olyan csoportokat mutat, amelyek valamennyi cégénél van taglista-olvasási, csoportkezelési vagy jogosultságkiosztási jog; a `canEdit` és `canAssign` a tényleges műveleti lehetőséget jelzi.

A közvetlen jogok és a csoportok jogai összeadódnak; nincs tiltó jog vagy szinthierarchia. A hozzárendelés minden kiválasztott cégnél hozzáférést készít, már regisztrált fióknak, külön meghívás nélkül. A céglista utólagos bővítése a meglévő csoporttagokra is érvényes. Cég kivétele, csoport törlése vagy tagság visszavonása csak az ebből a csoportból származó hozzáférést szünteti meg. Az önálló cégtagság, a közvetlen jogok és más csoportok jogai megmaradnak. Csoportművelet sosem aktivál újra felfüggesztett cégtagságot. Az üres, kizárólag csoportból létrejött hozzáférés eltűnik a munkaterületlistából, de a tagsági sor megőrzi a felfüggesztés és verzió előzményeit. Közvetlen nem üres joglista vagy elfogadott meghívó önálló hozzáférést alapít.

A rendszerben pontosan **egy védett admin csoport** van. Új cég létrehozásakor ez a meglévő definíció kap cégkapcsolatot, a létrehozó pedig csak az új cégnél kap admin-hozzárendelést. Nem készül cégenként új admin definíció. A csoportlistában az admin egy sor, a cégválasztás a **felhasználó → Csoportok → admin → Adminjog ezeknél a cégeknél** mezőben történik. Ugyanaz a csoport eltérő embereknek eltérő cégeknél adhat jogot. Egy új cég nem terjeszti ki a többi admin hozzáférését. A csoportlistában az admin tagszáma csak a kezelő számára látható cégekben érintett, különböző felhasználókat számolja.

Az admin definíció neve és automatikus jogköre védett; nem szerkeszthető és nem törölhető. A jogköre futásidőben a teljes `Permissions.Catalog` katalógust követi. A jelenlegi és későbbi jogokra kiterjedő hozzáférés kiosztásához minden kiválasztott cégnél admin jogkör vagy `system.manage` szükséges; az összes jelenlegi jog közvetlen birtoklása önmagában nem elég. Cégkezelő csak azokban a cégekben módosíthat admin-hozzárendelést, ahol aktuálisan joga van az adminjog delegálására. Egyik csoport sem ad globális `system.manage` jogot. Az egyéni csoportok korábbi céglistája, jogcsomagja és opcionális automatikus teljes jogköre megmarad.

| Végpont | Művelet |
|---|---|
| `GET /api/v1/permission-groups/companies` | Látható cégek, kiosztható jogok és kezelési lehetőségek |
| `GET /api/v1/permission-groups` | Közös csoportlista, céglistával, jogokkal és tagszámmal |
| `POST /api/v1/permission-groups` | `{ "name": "Sofőrök", "permissions": ["vehicles.read", "vehicles.odometer.create"], "companyIds": ["cég-uuid"], "allPermissions": false }` |
| `PUT /api/v1/permission-groups/{id}` | Egyéni csoport módosítása, továbbá az aktuális `version`; az admin definíció védett |
| `DELETE /api/v1/permission-groups/{id}?version=2` | Csoport és a belőle származó hozzáférések megszüntetése |
| `GET /api/v1/permission-groups/users/{userId}` | Kiosztható tagságok és a fiók aktuális verziója |
| `PUT /api/v1/permission-groups/users/{userId}` | `{ "groupIds": ["csoport-uuid"], "version": 3, "adminCompanyIds": ["cég-uuid"] }`; admin kijelölésekor kötelező, ismétlés nélküli céglista |

A korábbi `/api/v1/company-access/*` és `PUT /api/v1/members/{userId}/groups` végpontok megszűntek. A felhasználói csoportlista mentése az egyéni csoportoknál csak a kezelő által minden cégénél kiosztható tagságokat cseréli le. A közös adminnál csak a kezelő által adminjoggal kiosztható cégek kijelölése cserélődik; más cégeknél a célfelhasználó admin-hozzárendelése megmarad. A `GET` válasz `adminCompanyIds` mezője csak az aktuális kezelő által módosítható admin cégeket tartalmazza. Mentéskor admin kijelöléséhez legalább egy ilyen cég szükséges, admin kijelölése nélkül a lista legyen üres. A céglista sohasem következtethető ki pusztán a közös admincsoport azonosítójából. A többi tagság megmarad, amit a `hasOtherGroups` jelez, idegen cég- és csoportadatok nélkül. Csoportnév ugyanazon teljes cégkijelölésen belül egyedi, kis- és nagybetűtől függetlenül, legfeljebb 80 karakter. Módosításnál kötelező az aktuális verzió, ütközéskor új lekérés szükséges. Céglétrehozás is növeli a létrehozó fiókverzióját, mert új csoporttagságot hoz létre.

A tag- és hozzáférésválasz `permissions` mezője az effektív jogokat, `directPermissions` az egyedi jogokat, `groups` a csoportokat tartalmazza. A közvetlen jogokat szerkesztő kliens a `directPermissions` mezőből induljon. A csoportlistákban már nincs `isMultiCompany` típusjelző.

Minden módosítás egy tranzakcióban történik, az utolsó aktív jogkezelő védelmével és céges/rendszerszintű naplózással. A céges napló csak az adott cégre vonatkozó hatást tartalmazza. A globális definíciókat minden érintett cégre elvégzett API-ellenőrzés védi; a céges hozzáférési vetületeken FORCE RLS és a tényleges csoporttagságot, céglistát összekötő FK-k működnek. A `CreatedBy` történeti eredetadat; a migrált helyi csoportoknál `system:migration`, az eredeti műveletek változatlan auditrekordjai megmaradnak. Régi, fiók nélküli alanyok hozzárendelése is megmarad, a nevük foglalt; új hozzárendeléshez az API létező fiókot követel meg.

A `UnifiedPermissionGroups` migráció átmásolja a régi céges definíciókat, jogokat és tagságokat az egyetlen közös táblacsaládba, majd eltávolítja a régi három táblát. Az egyforma nevek nem vonódnak össze; ID-ütközéskor új csoportazonosító készül, az átvezetést a `group.unified` audit rögzíti. A közvetlen hozzáférés és felfüggesztés változatlan marad. A kapcsolódó csoport-, fiók- és tagságverziók frissülnek, ezért a korábban megnyitott űrlapokat újra kell tölteni. Frissítés előtt állítsd le az API-t, készíts mentést, futtasd a migrációt, és az új buildet indítsd. Visszaállítás mentéssel és a hozzá tartozó korábbi builddel lehetséges.

A `SharedAdminGroup` migráció a korábbi admin definíciókat egyetlen csoporttá vonja össze. A tényleges korábbi felhasználó–cég párokat menti át, a felfüggesztést, közvetlen jogokat, önálló tagságot és egyéni csoportokat változatlanul hagyja. Nem készít minden admin felhasználóból és minden cégből keresztszorzatot. Az új `group_user_companies` tábla az egyéni csoportok tényleges hatókörét is rögzíti; a céges vetület FK-ja megköveteli a pontos csoport–felhasználó–cég kapcsolatot. A régi adminazonosító és a közös új azonosító az `admin_group.consolidated` auditban követhető. Az érintett felhasználói és cégtagsági verziók frissülnek, a korábbi naplórekordok változatlanok. Frissítés előtt API-leállítás és adatbázismentés szükséges; visszaállítás mentésből, a korábbi builddel lehetséges.

A járműadatok külön `PUT /api/v1/vehicles/{id}` végponton módosíthatók (`registration`, `make`, `model`, `version`). A km-rögzítés külön `POST /api/v1/vehicles/{id}/odometer` végpont (`kilometers`, `version`), változtathatatlan előzménnyel, csökkenő vagy negatív érték nélkül. Mindkettő növeli a jármű verzióját. Telephelymodul még nincs; a saját jogait a modul elkészítésekor kell felvenni és szerveroldalon ellenőrizni.

## API

### Rendszerszintű felhasználókezelés

A külön, közvetlenül felhasználónként kiosztott `system.manage` jog minden céghez, minden jelenlegi céges művelethez és a globális profilokhoz hozzáférést ad, céges tagság létrehozása nélkül. A céges `permissions.manage`, a regisztráció és a céglétrehozás nem ad globális jogot. A globális jog továbbadható; az utolsó kezelő joga nem vonható vissza. A rendszerszintű hozzáférés felülírja a céges felfüggesztést is; megszüntetéséhez a globális jogot kell visszavonni.

Az első kezelőt az adatbázis üzemeltetője állíthatja be meglévő felhasználói ID-val, mentés után, leállított API mellett. A projekt gyökeréből:

```powershell
./scripts/dev-backend.ps1 -BootstrapSystemAdminUserId '<meglévő-felhasználói-ID>' -DatabasePort 55432
```

A parancs migrációs adatbázis-hozzáférést igényel, migrál és kilép; a `-Migrate` kapcsolóval külön futtasd. Naplózza a `bootstrap:database-operator` kezdeményezőt, és megtagadja a műveletet, ha már van rendszerszintű kezelő. Ezután a **Rendszerkezelés → Összes felhasználó → Profil megnyitása** felületen adható tovább a jog. Céges tagoknál is megjelenik a **Profil megnyitása** gomb a globális kezelőnek.

A név, belépési e-mail és telefonszám szerkeszthető. Az ID, a hash-ek és a belső Identity-mezők nem írhatók felül a profil kérésével. E-mail-változáskor a belépési név is frissül, a megerősítés törlődik és minden régi munkamenet érvénytelenné válik. A profil és jelszó módosítása adatbázis-sorzárat használ; az adminműveletek aktuális `version` értéket kérnek, elavult verzióra `409` érkezik. A globális jog módosítása és a jogosult írások közös tranzakciós zárral védekeznek a párhuzamos visszavonás ellen.

A fiókok tényleges belső elsődleges kulcsa a regisztrációkor választott felhasználónév: `Id = UserName`, például `mark.nemoda`. A rendszer levágja a külső szóközöket és kisbetűs alakban tárolja. Az egész rendszerben egyedi, a teljes névtől és az e-mailtől független, állandó azonosító; nincs mögötte külön UUID-alapú felhasználói kulcs. Formátuma 3–64 karakter: `a–z`, `0–9`, `.`, `_`, `-`; az első karakter betű vagy szám. A kis- és nagybetű azonosnak számít. A felhasználónév később nem nevezhető át a profil API-val; az adatbázis is ellenőrzi a kulcs változatlanságát és az Identity-felhasználónév egyezését. Az e-mail és a megjelenített név továbbra is szerkeszthető. Az azonosító ismerete nem ad hozzáférést.

A `20261020080711_UsernameIdentity` migráció a meglévő fiókok e-mail-címének `@` előtti részéből készít felhasználónevet, kisbetűsítéssel, a magyar ékezetek átírásával és a nem támogatott karakterek cseréjével. A rövid neveket `user.` előtag egészíti ki, a hosszúak 64 karakterre rövidülnek; névütközéskor `.2`, `.3` stb. utótag készül, determinisztikus régi ID-sorrendben. A korábbi azonosítók és a fiók nélküli történeti szereplők nevei fenntartottak, hogy új regisztráció ne örökölhessen régi hozzáférést vagy naplóbeli személyazonosságot. Az eredményt az üzemeltető a `user_identity_history` táblában ellenőrizheti.

A migráció átvezeti a céges tagságokat, jogokat, meghívók kezdeményezőit és az Identity hivatkozásait, megőrzi a jelszóhash-eket, valamint külön naplózza a régi/új azonosítót. A régi auditrekordokat nem írja át: a napló API az immutable előzménytábla segítségével visszaadja a felhasználónevet és az `originalActorSubject` / `originalTargetSubject` mezőkben a korábbi azonosítót is. Az eredeti részletek változatlanok maradnak. Az előzménytábla nem szolgál régi ID-s belépésre vagy profilcímzésre. Az átállás érvényteleníti a korábbi munkameneteket; a meglévő jelszóval újra be kell lépni. Frissítéshez állítsd le az API-t, készíts mentést, futtasd a migrációt, majd az új buildet indítsd. A `Down` irány tiltott; visszaállítás csak mentéssel és a hozzá tartozó régi builddel végezhető.

A kötelező jelszócsere elrendelése érvényteleníti a meglévő munkameneteket. A következő, jelenlegi jelszóval történő belépés `passwordChangeRequired: true` korlátozott munkamenetet ad. Ekkor csak CSRF-token, munkamenet-lekérdezés, kijelentkezés és jelszócsere engedélyezett; minden üzleti API `403 / password_change_required` hibát ad. Az új jelszó 12–128 karakter, eltér a régitől és megerősítést igényel. Hibás jelenlegi jelszó növeli a zárolási számlálót, sikertelen csere nem oldja fel a korlátozást. Sikeres csere csak az aktuális munkamenetet frissíti; minden más belépés érvénytelen lesz. Kérj friss CSRF-tokent. Elfelejtett jelszó visszaállítása és automatikus e-mail-küldés továbbra sincs.

A központi napló profilváltozás, jelszócsere/elrendelés, globális jogmódosítás, céglétrehozás, járműfelvétel és céges hozzáférés-módosítás esetén az adatváltozással közös tranzakcióban készül. Tartalma: módosító/érintett ID, UTC időpont, cég (ha van), művelet és releváns előtte/utána adatok. Jelszó, hash, biztonsági bélyeg és meghívási token nem kerül bele. A `system_audit_events` táblát PostgreSQL-trigger védi a runtime adatbázis-felhasználó általi frissítéstől és törléstől. A globális napló csak `system.manage` joggal olvasható. Frissítés előtt készíts mentést; régebbi verzióra visszaállításhoz a mentést és a megfelelő korábbi buildet használd.

| Művelet | Végpont |
|---|---|
| Saját jelszó cseréje | `POST /api/v1/auth/change-password` |
| Globális lista/profil (`system.manage`) | `GET /api/v1/system/users`, `GET /api/v1/system/users/{id}` |
| Profilszerkesztés (`system.manage`) | `PUT /api/v1/system/users/{id}` |
| Kötelező jelszócsere (`system.manage`) | `POST /api/v1/system/users/{id}/require-password-change` |
| Globális jog kiosztása/visszavonása (`system.manage`) | `PUT /api/v1/system/users/{id}/system-access` |
| Központi módosítási napló (`system.manage`) | `GET /api/v1/system/audit-events` |

A globális listák `page` paraméterrel, 25 elem/oldal mérettel lapozhatók. A felhasználólista legfeljebb 100 karakteres `search` paramétert fogad: név, e-mail, felhasználónév részlete. Szűrők: `role=all|admin|member` és `access=all|with|none`. Az adminszűrő a rendszerszintű kezelőket és az aktív céges adminokat is tartalmazza; a hozzáférés a felfüggesztést és a csoportból származó jogokat is figyelembe veszi. A válasz `isAdministrator` és `companyAccess` mezői megmutatják a jogkört és az érintett cégeket. A Felhasználók oldalon rendszerszintű kezelőként az Összes felhasználó fül az alapértelmezett, céges tagság nélküli fiókokkal együtt; cégkezelő továbbra is csak a saját céges tagjait láthatja.

Profilszerkesztés: `{ displayName, email, phoneNumber, version }`; jelszócsere-elrendelés: `{ version }`; globális jog: `{ enabled, version }`; saját jelszócsere: `{ currentPassword, newPassword, confirmPassword }`. A módosítások CSRF-védettek, a jelszóműveletek sebességkorlátozottak.

### Cégek, telephelyek és kapcsolattartók

A **Cégek és telephelyek** oldalon kereshető, állapot szerint szűrhető céglista található. A megnyitott cégnél külön fülön szerkeszthetők a törzsadatok és kapcsolattartók, kezelhetők a telephelyek és jármű-hozzárendelések, illetve olvasható a változásnapló. A listában alapból az aktív cégek szerepelnek; az archivált és felfüggesztett cégek szűréssel érhetők el. A normál flottamunkaterület csak az aktív cégeket tartalmazza.

| Művelet | Jogosultság | Végpont |
|---|---|---|
| Hozzáférhető céglista, állapottól függetlenül | Saját céges műveleti jogok alapján szűrve | `GET /api/v1/companies?page=1&search=&status=Active` |
| Cégtörzs megtekintése | `companies.read` | `GET /api/v1/company` |
| Cégtörzs módosítása | `companies.update` | `PUT /api/v1/company` |
| Állapot és adatverzió lekérése | `companies.status` | `GET /api/v1/company/state` |
| Felfüggesztés, archiválás, visszaállítás | `companies.status` | `PATCH /api/v1/company/status` |
| Kapcsolattartók megtekintése | `companies.read` | `GET /api/v1/company/contacts?includeArchived=false` |
| Kapcsolattartó létrehozása / módosítása | `companies.update` | `POST /api/v1/company/contacts`, `PUT /api/v1/company/contacts/{id}` |
| Kapcsolattartó archiválása / visszaállítása | `companies.update` | `PATCH /api/v1/company/contacts/{id}/status` |
| Telephelyek megtekintése | `sites.read` | `GET /api/v1/company/sites?includeArchived=false` |
| Telephely létrehozása | `sites.create` | `POST /api/v1/company/sites` |
| Telephely szerkesztése | `sites.update` | `PUT /api/v1/company/sites/{id}` |
| Telephely archiválása / visszaállítása | `sites.archive` | `PATCH /api/v1/company/sites/{id}/status` |
| Járművek és telephelyeik | `sites.read` és `vehicles.read` | `GET /api/v1/company/vehicles` |
| Jármű áthelyezése / hozzárendelés megszüntetése | `sites.vehicles.assign` és `vehicles.read` | `PUT /api/v1/company/vehicles/{id}/site` |
| Céges törzsadat-változások | `audit.read` | `GET /api/v1/company/audit-events?page=1` |

A `/company` végpontok az `X-Tenant-Id` fejlécből választanak céget. Minden művelet a cég aktuális közvetlen és csoportos jogait ellenőrzi; az admincsoport az új jogokkal automatikusan bővül. A jogok cégszintű műveleti jogok, jelenleg nem telephelyenkénti felhasználói hozzáférési korlátozások. A jármű telephelyhez rendelése nem ad járműadat-szerkesztési vagy kilométer-rögzítési jogot. Az állapotkezelési jog önmagában nem tárja fel a cég hivatalos és kapcsolattartási adatait.

A cégtörzs mezői: megjelenített és hivatalos név, adószám, cégjegyzékszám, közösségi adószám, strukturált székhely, központi e-mail, telefon, weboldal, időzóna, pénznem és távolságegység. Az országkód két, a pénznem három betű. Az adószámok tárolt törzsadatok; nincs külső cégnyilvántartási ellenőrzés. A távolságegység egy mentett alapbeállítás; a jelenlegi kilométeróra-adatok továbbra is kilométerben maradnak. A kapcsolattartó névvel, beosztással, e-maillel és telefonnal szerepel; a telephely saját névvel, cégen belül kis/nagybetűtől függetlenül egyedi ASCII-kóddal, címmel, e-maillel, telefonnal és opcionális kapcsolattartóval rendelkezik. A megjelenített cégnév kötelező, a többi törzsadat fokozatosan tölthető ki. A meglévő cégekhez a migráció HU / HUF / km alapbeállítást ad, de nem talál ki hivatalos nevet, címet vagy létrehozási időpontot.

A módosítások `version` értékkel védettek; az elavult változat `409` választ kap, részleges mentés nélkül. Cégállapot-módosítás: `{ status: "Active" | "Suspended" | "Archived", reason, version }`; kapcsolattartó és telephely állapota: `{ isArchived, reason, version }`. Az indok kötelező. Jármű-hozzárendelés: `{ siteId, version }`, ahol a `null` megszünteti a hozzárendelést, a verzió pedig a jármű aktuális verziója. Telephely csak jármű-hozzárendelések nélkül archiválható. Aktív telephely kapcsolattartója előbb cserélendő; archivált kapcsolattartóhoz tartozó telephely visszaállítása előtt a kapcsolattartót is aktiválni kell. Archivált telephelykód nem használható újra.

Inaktív cégnél a normál jármű-, tagság- és jogosultsági műveletek leállnak, a céges kezelővégpontokon a korábbi jogokkal továbbra is megtekinthetők az adatok és a napló. Törzsadatmódosítás csak visszaállítás után lehetséges. Az aktiválás megőrzi a tagságokat, a jogokat, a járműveket és a telephelyeket. A profilok, kapcsolattartók, telephelyek és jármű-hozzárendelések EF-szűrővel és PostgreSQL `FORCE ROW LEVEL SECURITY` szabállyal védettek; az összetett idegen kulcsok a másik céghez kapcsolást is kizárják. A műveletek a cégzáron belül újraellenőrzik a hozzáférést és az állapotot.

Minden létrehozás, szerkesztés, állapotváltozás és jármű-hozzárendelés a céges és a központi naplóba kerül, a módosítóval és az előtte–utána adatokkal. Mindkét napló adatbázisszinten tiltja a meglévő sorok átírását és törlését. Nincs fizikai cégtörlési végpont; visszaállításhoz az állapotkezelést használd.

### Céges és fiókvégpontok

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

A regisztráció törzse `userName`, `displayName`, `email`, `password`. A belépés `userName` + `password` vagy `email` + `password` adatokat fogad; az új felület mindkettőt támogatja. A regisztráció válaszának `id` mezője maga a kanonikus felhasználónév. A céglétrehozás törzse `name`, a járműfelvételé `registration`, `make`, `model`.

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
$env:HERMES_SMOKE_ISOLATED = 'true'
node scripts/smoke-auth.mjs
```

Alapértelmezett címe http://localhost:8080; másik címhez állítsd be a `HERMES_BASE_URL` változót. A script saját, véletlen hitelesítő adatokkal két tesztfiókot és két céget hoz létre, ezért kizárólag elkülönített, eldobható adatbázison futtasd. A `HERMES_SMOKE_ISOLATED=true` beállítás ezt kifejezetten jelzi; a kapcsoló önmagában nem hoz létre tesztadatbázist. A normál helyi `hermes` adatbázison ne futtasd. A CI külön PostgreSQL-konténert használ. Ellenőrzi a meghívást, a közvetlen jogokat, az azonnali visszavonást és az eseménynaplót is. A tesztjelszavakat és a meghívótokeneket nem írja ki.

### Kifejezett helyi adminbeállítás és tesztadat-archiválás

Az API nem hoz létre automatikus alapértelmezett fiókot. A `--configure-development-admin <manifest.json>` egyszeri üzemeltetői parancs kizárólag `Development` környezetben, helyi adatbázissal futtatható, a migrációs kapcsolattal. A jelszót a `HERMES_DEVELOPMENT_ADMIN_PASSWORD` környezeti változóból veszi; a manifest például `{ "archiveUserIds": [], "archiveTenantIds": [], "retireSubjects": [] }`. Előtte készíts `pg_dump` mentést, és állítsd le az API-t. A manifestbe csak előzetesen ellenőrzött tesztfiókok és tesztcégek pontos azonosítóit írd.

A parancs létrehozza/frissíti az `admin` fiókot, kizárólag nála hagyja meg a `system.manage` jogot és az automatikusan bővülő admincsoportot, minden megmaradó céghez hozzáférést ad neki. Más valódi fiókok közvetlen jogait és üzleti adatait megőrzi. A kijelölt tesztfiókokat tartósan letiltja, a tesztcégeket archiválja: eltűnnek az aktív listákból, az ismert cégazonosító sem ad hozzáférést. A fiókok, cégek és megváltoztathatatlan naplók történeti rekordjai megmaradnak. A korábbi adminok és archivált fiókok munkameneteit érvényteleníti, minden érintett cégnél és a központi naplóban rögzíti a változást. A fejlesztői fiókkal éles környezetben sem belépni, sem korábban kiadott munkamenetet használni nem lehet. A szokásos regisztráció és jelszócsere legalább 12 karakteres követelménye változatlan.

Új migráció a `backend` mappából:

```powershell
dotnet tool restore
dotnet ef migrations add MigrationName --project src/Hermes.Infrastructure --startup-project src/Hermes.Api
```

A kiszolgáló nem migrál automatikusan: a migrációs parancs `ConnectionStrings__Migrations`, az API `ConnectionStrings__Database` beállítást használ. A következő üzleti modulok a sofőrök, karbantartások, költségek és előfizetések kezelése.

A `20261020002000_TenantPermissions` migráció a korábbi `Owner` tagságokat az akkori 7 jogra, a `FleetManager` tagságokat `vehicles.read` + `vehicles.create`, a `Viewer` tagságokat `vehicles.read` jogra fordítja. Minden átalakításról naplóbejegyzés készül, majd a régi `Role` oszlop megszűnik. A meglévő tagságok aktívak, verziójuk 1; az ismeretlen régi csatlakozási idő `null`. A szemcsés jogok veszteség nélkül nem alakíthatók vissza fix szerepkörökké, ezért a migráció `Down` iránya tiltott. Frissítés előtt készíts adatbázismentést; visszaállításhoz azt és a hozzá tartozó korábbi alkalmazásverziót használd. Migrálás előtt állítsd le a régi API-t, majd az új sémával az új buildet indítsd.
