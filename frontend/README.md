# HERMES frontend base

A React + TypeScript + Vite kliens jelenlegi kiinduló állapota. A frontend most a backend működésének kipróbálását és az alapvető felhasználói folyamatokat szolgálja; a további fejlesztés elsődleges területe a backend.

## Az alapban működő felületek

- Regisztráció, bejelentkezés és kijelentkezés a valódi API-val.
- Első cég létrehozása, további cégek felvétele és cégváltás.
- Céges járműlista, kliensoldali keresés és állapotszűrés, járműfelvétel.
- Aktuális cégadatok és a felhasználó céges szerepkörének megjelenítése.
- Betöltési és hibaállapotok, munkamenet-ellenőrzés és a privát lekérdezési adatok törlése kijelentkezéskor vagy észlelt lejáratkor.

A járműfelvételt a felület Owner és FleetManager szerepkörnél kínálja fel. A jogosultságok végső ellenőrzése a backend feladata.

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

A tesztek az API-kliens működését, a fiókfolyamatokat, a cégváltást és a munkamenethez tartozó gyorsítótár kezelését ellenőrzik. A build TypeScript-ellenőrzést és Vite-csomagolást futtat.

## Kapcsolódás a backendhez

A közös API-kliens a `src/api.ts`, a belépési és céglétrehozási űrlapok a `src/AccountForms.tsx`, a munkaterület a `src/App.tsx` fájlban található. A szerveradatokat TanStack Query kezeli, a céges lekérdezések felhasználó- és cégazonosító szerinti kulcsot kapnak.

A kliens azonos eredetű, sütialapú API-kéréseket használ. A módosító kérések CSRF-tokenjét automatikusan kezeli, a járműkérésekkel `X-Tenant-Id` fejlécet küld. Belépési tokent nem tárol a localStorage-ban.

A backend önálló indításához lásd a [backend README-jét](../backend/README.md), a teljes rendszerhez és a Docker Compose-hoz a [projekt README-jét](../README.md).
