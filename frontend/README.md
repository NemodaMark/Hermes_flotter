# HERMES frontend base

A React + TypeScript + Vite kliens jelenlegi kiinduló állapota. A frontend most a backend működésének kipróbálását és az alapvető felhasználói folyamatokat szolgálja; a további fejlesztés elsődleges területe a backend.

## Az alapban működő felületek

A `system.manage` joggal rendelkező felhasználó a **Rendszerkezelés** menüben az összes fiókot és a központi módosítási naplót eléri. A **Profil megnyitása** gomb a céges taglistában is megjelenik számára. A profil név/e-mail/telefonszám adatai szerkeszthetők, az állandó ID látható; a jelszócsere elrendelése és a teljes rendszerszintű jog átadása/visszavonása külön megerősítést kér. A régi verzióval történő mentés hibájánál a profil kifejezetten újratölthető. A céges jogosultságkezelés önmagában nem ad hozzáférést ezekhez a műveletekhez.

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
