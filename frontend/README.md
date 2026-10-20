# HERMES frontend base

A React + TypeScript + Vite kliens jelenlegi kiinduló állapota. A frontend most a backend működésének kipróbálását és az alapvető felhasználói folyamatokat szolgálja; a további fejlesztés elsődleges területe a backend.

## Az alapban működő felületek

A **Járművek → Adatlap** a rendszámmal azonosítja az autót, szerkeszti a műszaki, tulajdonlási és határidőadatokat, külön fülön kezeli a telephelyet, lízingszerződéseket és szervizbejegyzéseket. A rendszám- és kilométerelőzmények, valamint a módosítási napló lapozhatók. Az archivált jármű visszaállítás után szerkeszthető. A Lízing és Szerviz fülön a mentett bejegyzés **Dokumentumok** gombjával fájl tölthető fel és le. Új bejegyzés mentése után a dokumentumablak automatikusan megnyílik. Webcím továbbra is megadható. PDF, JPG, PNG, DOCX és XLSX támogatott, fájlonként legfeljebb 10 MB. A visszavonás és visszaállítás indoklással történik, az előzmény megmarad. A listához és letöltéshez megtekintési, a feltöltéshez és állapotváltáshoz kezelési jog kell, a jármű telephelykorlátjával.

A **Partnerek** menüben cégenként vehetők fel lízingbeadók és szervizek, akár mindkét kategóriával és több kapcsolattartóval. A kereső, kategóriaszűrő, archiváltak kapcsolója és lapozás a backend listáját használja. A partnernév a jármű lízing- vagy szervizadatainál választható ki. A történeti szerviz-kilométer és következő határidő nem változtatja meg automatikusan az aktuális járműadatot.

A dokumentumablak **Megtekintés** gombja PDF-et, JPG-t és PNG-t mutat az alkalmazáson belül. A PDF lapozható, mindkét előnézet nagyítható és szélességhez igazítható. A DOCX/XLSX letöltéssel nyitható meg. A `DocumentPreview.tsx` frissen hitelesített, megszakítható tartalomlekérést használ, a `PdfPreview.tsx` a helyben csomagolt PDF.js segítségével egy oldalt rajzol vászonra. Bezáráskor megszűnik a lekérés, az ideiglenes kép-URL és a PDF worker. A fájltartalom nem kerül a TanStack Query gyorsítótárába. A `pdfAssets.ts` fejlesztéskor és buildnél biztosítja a PDF.js verziójával egyező helyi karaktertáblákat, betűkészleteket és dekódolókat; az eredményhez nincs szükség külső megjelenítőszolgáltatásra.

A járműadatlap **Dokumentumok** füle közvetlen járműokmányokat kezel: **Forgalmi engedély**, **Biztosítás**, **Műszaki vizsga**. Feltöltéskor kategória választható, a lista kategóriánként szűrhető. Ugyanaz a `VehicleDocuments` komponens és előnézet működik beágyazva, mint a lízing- és szervizfájloknál; szerződés vagy szervizbejegyzés nem szükséges. A fül és a feltöltési/állapotváltási gombok az adott járműhöz visszaadott `vehicles.documents.read/manage` jogokat követik, az archivált jármű okmányai olvashatók. A közvetlen okmány mentése a jármű verzióját növeli, a PDF- és képelőnézet a közvetlen tartalomvégpontot használja.

A konténeres Nginx a `.mjs` workerhez JavaScript-, a `.wasm` dekódolóhoz WebAssembly-tartalomtípust küld, a hiányzó PDF.js-kiegészítőt `404` válasszal jelzi. A `node scripts/smoke-document-preview.mjs` olvasási ellenőrzés a futó frontend build workerét, betűkészletét és dekódolóját vizsgálja; `HERMES_BASE_URL` hiányában a `http://localhost:8080` címet használja. A CI a valódi konténeres kiszolgálón futtatja ezt.

A lízing- és szervizműveletek a járműhöz visszaadott saját műveleti jogokat követik. A partnerjogok külön, cégszinten oszthatók ki; a hiányzó listajog mellett a felvételi jog használható. Az elavult mentés szerverhibáját a felület megőrzi a szerkesztett adatokkal, az adatlap frissítési gombbal tölthető újra.

A **Beállítások → Rendszerkezelés** összecsukható almenüt kizárólag `system.manage` joggal lehet látni; itt a központi napló és a csoportkezelés érhető el. A felhasználók egyetlen listában szerepelnek: alapból a kiválasztott cég tagjai, rendszergazdának az **Összes felhasználó** kapcsolóval az összes fiók, a céges hozzáférés nélküliek is. A tábla rövid jogösszegzést mutat, a részletek a kezelőgombokkal érhetők el.

A felhasználó neve vagy **Adatlap** gombja teljes profiloldalt nyit (`#/profile/felhasználónév`). Bármely aktív céges munkatárs megtekintheti a kolléga alapadatait és profilképét; a fiókbiztonsági adatok kezelése továbbra is kizárólag rendszerszintű jog. Saját név, telefonszám és profilkép szerkeszthető. A rendszergazda e-mailt, globális jogot és kötelező jelszócserét is kezelhet; az utóbbiak külön megerősítést kérnek. A profil az aktuális cégben nála lévő, a megtekintő által olvasható járműveket mutatja. A használó a jármű adatlapján, `vehicles.users.assign` műveleti joggal jelölhető ki.

Az **Új jármű** teljes oldalas felvitel ugyanazt a `VehicleFields` űrlapot használja, mint a szerkesztés, karosszériatípussal és kezdő kilométerrel. A gyártó és modell írható választó; a mentett új értékek cégenként megmaradnak javaslatként. A járműhöz opcionálisan legfeljebb **5 JPG/PNG kép** tölthető fel, képenként **5 MiB** méretig. Megszakadt feltöltésnél csak a megmaradt képek próbálódnak újra, a létrehozott autó nem duplikálódik. A védett képek friss hitelesített lekérésből jelennek meg; váltáskor és bezáráskor az ideiglenes kép-URL felszabadul.

Előírt jelszócsere esetén belépés után a **Kötelező jelszócsere** képernyő jelenik meg a munkaterület és a meghívóelfogadás előtt. Csak sikeres, jelenlegi jelszóval igazolt csere után lehet továbblépni; kijelentkezni közben is lehet. A backend ugyanezt a korlátozást minden üzleti API-n ellenőrzi. A globális jog első, naplózott beállítását és az API-k részleteit a [projekt leírása](../README.md#rendszerszintű-felhasználókezelés) tartalmazza.

- Regisztráció, bejelentkezés és kijelentkezés a valódi API-val.
- Regisztrációnál külön, egyedi felhasználónév választható, amely az állandó belső ID is. Belépni felhasználónévvel vagy e-maillel lehet. A taglisták a felhasználónevet mutatják elsődlegesen, mellette a teljes nevet és az e-mailt. A régi naplóknál a feloldott felhasználónév mellett a részletekben az eredeti ID is megmarad.
- Első cég létrehozása, további cégek felvétele és cégváltás.
- Céges járműlista, kliensoldali keresés és állapotszűrés, járműfelvétel.
- Aktuális cégadatok és a felhasználó cégenkénti konkrét jogainak megjelenítése.
- Felhasználók oldal a kiválasztott cég taglistájával, név/e-mail szerinti kereséssel és lapozással.
- Meghívó létrehozása kiosztott jogokkal, egyszer másolható csatlakozási hivatkozás, meghíváslista és visszavonás.
- Jelölőnégyzetes jogkiosztás, hozzáférések felfüggesztése és visszaállítása, tagsági verzióütközés kezelése.
- Meghívó elfogadása a megfelelő fiókkal; a folyamat regisztráció vagy bejelentkezés után is folytatható.
- Betöltési és hibaállapotok, munkamenet-ellenőrzés és a privát lekérdezési adatok törlése kijelentkezéskor vagy észlelt lejáratkor.

A járműfelvételt a felület `vehicles.create`, a járműlistát `vehicles.read` jog esetén kínálja fel. A saját céges jogokat időszakosan és sikeres kezelés után frissíti; a végső ellenőrzés minden kérésnél a backend feladata. A felhasználókezelés minden vezérlője a hozzá tartozó jogtól függ, és a kezelő saját delegálási körén kívüli jogokat zárolva mutatja. Elavult szerkesztésnél a friss adatok kifejezett újratöltése szükséges; a szerver az utolsó jogosultságkezelő eltávolítását is megakadályozza.

## Felhasználók kezelése

Válassz céget a **Munkaterület** mezőben, majd nyisd meg a **Felhasználók** menüt. A taglista `members.read`, a meghívás és visszavonás `members.invite`, a jogszerkesztés `permissions.manage`, a felfüggesztés/visszaállítás `members.update` jogot használ. Taglista nélküli jogosultságkezelő ismert felhasználóazonosítóval is megnyithatja a jogszerkesztőt. A felfüggesztés csak az aktuális céget érinti.

A **Felhasználó meghívása** ablakban add meg a címzett e-mail-címét és a jogokat. A meghívó létrehozása után másold ki a hivatkozást, és külön juttasd el a címzettnek. Automatikus e-mail-küldés nincs. A token a hivatkozás `#` utáni részébe kerül, így nem része a HTTP URL-nek vagy Referer fejlécnek; elfogadás vagy bezárás után a felület eltávolítja a címsorból. A hivatkozás a létrehozó ablak bezárása vagy cégváltás után nem állítható elő újra; szükség esetén vond vissza a meghívót, és készíts újat.

A meghívott megnyitja a hivatkozást, belép vagy regisztrál a megadott e-mail-címmel, majd kifejezetten elfogadja a meghívót. A rendszer ezután a megfelelő céget választja ki. Másik e-mail-cím, lejárt vagy visszavont meghívó esetén a szerver hibáját mutatja.

## Indítás és ellenőrzés

Előfeltétel: Node.js 22.20 vagy a `package.json` által támogatott újabb verzió, valamint a futó backend és adatbázis.

A `frontend` mappából:

```powershell
npm ci
npm run dev
```

Helyi cím: http://127.0.0.1:5173/. A Vite az `/api` és `/health` kéréseket alapértelmezésben a http://127.0.0.1:5080 címre továbbítja. Eltérő backendcímhez az indítás előtt állítsd be az `API_PROXY_TARGET` környezeti változót.

```powershell
npm test
npm run build
```

A tesztek az API-klienst, a fiókfolyamatokat, a céges fejlécet és CSRF-et, a delegálási korlátot, a meghívási hivatkozást, a felfüggesztést/visszaállítást, a verzióütközést, a cégváltást és a lejárt munkamenet kezelését ellenőrzik. A build TypeScript-ellenőrzést és Vite-csomagolást futtat; `npm run lint` végzi a statikus kódellenőrzést.

## Kapcsolódás a backendhez

A közös API-kliens a `src/api.ts`, a belépési és céglétrehozási űrlapok a `src/AccountForms.tsx`, a munkaterület a `src/App.tsx` fájlban található. A szerveradatokat TanStack Query kezeli, a céges lekérdezések felhasználó- és cégazonosító szerinti kulcsot kapnak.

A felhasználókezelő oldal a `src/MembersPage.tsx`, a szerkesztők a `src/MemberDialogs.tsx`, a meghívó fogadóoldala a `src/InvitationScreen.tsx`, a hivatkozás kezelése a `src/invitationLink.ts` fájlban van. Cégváltáskor a kezelő és a nyitott szerkesztő új példányt kap; az előző cég adatai és egyszer látható meghívója nem maradnak a képernyőn. Kijelentkezéskor vagy észlelt lejáratkor a privát lekérdezések és mutációs eredmények is törlődnek a kliens gyorsítótárából.

A kliens azonos eredetű, sütialapú API-kéréseket használ. A módosító kérések CSRF-tokenjét automatikusan kezeli, a járműkérésekkel `X-Tenant-Id` fejlécet küld. Belépési tokent nem tárol a localStorage-ban.

A backend önálló indításához lásd a [backend README-jét](../backend/README.md), a teljes rendszerhez és a Docker Compose-hoz a [projekt README-jét](../README.md).

## Jogosultságcsoportok és km-rögzítés

A Felhasználók oldalon a Jogosultságcsoportok fül listázza a céges jogcsomagokat. Létrehozáshoz, szerkesztéshez és törléshez `permission-groups.manage` szükséges; felhasználóhoz rendeléshez a sor Csoportok gombja és `permissions.manage` jog kell. Csoportot a meghívás elfogadása után lehet rendelni a taghoz. Több csoport és egyedi jog összeadódhat. Az egyedi jogok szerkesztése a `directPermissions` mezőből indul, nem másolja át a csoportjogokat.

A védett admin csoport minden jelenlegi és jövőbeli céges jogot megkap. Nem szerkeszthető és nem törölhető; tagságát céges admin vagy rendszergazda kezelheti. A csoportból kapott jogok a felhasználói listában láthatók. Csoportszerkesztés minden tagot érint; törlés előtt megjelenik az érintett felhasználók száma. Ütköző verzió esetén friss adatokat kell betölteni.

A járműlistában külön gomb kezeli az adatokat (`vehicles.update`) és a kilométerállást (`vehicles.odometer.create`). A km-rögzítőnek nem kell járműszerkesztési jog. A listához továbbra is `vehicles.read` szükséges. A beviteli ablakok a szerver által visszaadott verziót küldik, és megjelenítik a visszautasítás okát.

## Többcéges csoportok

A Felhasználók → Többcéges csoportok fül csoportonként cégeket és jogokat kezel. A cégkezelő csak a saját, megfelelő joggal kezelt cégeit választhatja; a joglista a kiválasztott cégeknél kiosztható jogok metszete. A cégválasztás megváltoztatása törli a már nem kiosztható jogok jelölését. A teljes, későbbi jogokra is kiterjedő hozzáférés külön opció, admin jogosultsághoz kötve.

Kiosztás: felhasználó sora → Csoportok. A checkboxoknál látható a céglista és a jogcsomag. Új cég kijelölése meglévő csoporttagokat is hozzáad; cég vagy csoport kivétele csak az onnan kapott hozzáférést szünteti meg, és nem aktivál felfüggesztett tagságot. A nem kezelhető csoporttagságok megmaradnak. Rendszerszintű kezelő az egységes felhasználólista **Összes felhasználó** kapcsolójával megnyitott profilról, cégtagság nélkül is indíthat hozzárendelést.

A helyi csoportszerkesztő kiszűri az `isMultiCompany` jelölésű csoportokat. A többcéges kiosztás a fiók verzióját, a csoportszerkesztés a csoport verzióját küldi. Ütközéskor az újratöltés friss verzióval kezdi újra a szerkesztést.
