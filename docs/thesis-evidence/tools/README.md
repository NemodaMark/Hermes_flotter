# A háttércsomag reprodukciója

A lépések a [rögzített alkalmazásverziót](https://github.com/NemodaMark/Hermes_flotter/tree/9421b69278601c8b7e73d032f88858dbc0bb4f2e) használják. A csomag segédszkriptjei a háttéranyag commitjában találhatók. A futtatókimenet, a kezdeti admin-jelszó és a tesztfiókok adatai Git-en kívüli munkakönyvtárban legyenek.

## Elkülönített alkalmazáspéldány

1. Készíts új PostgreSQL 18 klasztert és új üres adatbázist. A képekhez az 55439 (adatbázis), 5087 (API) és 5187 (Vite) portot használtam, kizárólag 127.0.0.1-en. Az adatbázis-szerepkörökhöz használható [az inicializációs példa](../../../infra/postgres). A migrációs szerep legyen az adatbázis tulajdonosa. A futtatói szerep kapjon PostgreSQL `USAGE` jogot a sémára, valamint a migrációs szerep alapértelmezett táblajogai között SELECT, INSERT, UPDATE és DELETE jogot. A futtatói szerep `NOSUPERUSER NOBYPASSRLS` legyen.
2. A [projekt README-je](../../../README.md) alapján add meg a szerepekhez a `ConnectionStrings__Migrations` és `ConnectionStrings__Database` értéket. Használj `Development` környezetet, külön `DataProtection__KeyPath` könyvtárat és helyi `ASPNETCORE_URLS=http://127.0.0.1:5087` címet. A képekhez az `Entra__Enabled=false` volt aktív. A fiktív tömeges betöltés alatt a külön példány `Security__AccountPermitLimit` értéke 2000 volt.
3. A `dotnet build backend/src/Hermes.Api/Hermes.Api.csproj -c Release -o "$Run/api"` parancs után állíts be ideiglenes `HERMES_INITIAL_ADMIN_PASSWORD`-ot. Indítsd a DLL-t `--initialize-system-admin admin admin@demo-flotta.example.test` argumentummal. Ez alkalmazza a migrációkat is. Ezután indítsd a DLL-t argumentum nélkül és ellenőrizd a `/health/ready` végpontot.
4. A `frontend` mappában futtasd az `npm ci` parancsot. Indítsd a Vite szervert `API_PROXY_TARGET=http://127.0.0.1:5087` és `npm.cmd run dev -- --host 127.0.0.1 --port 5187 --strictPort` használatával.
5. Másold a `scripts/seed-demo-data.mjs` és `scripts/demo-data.mjs` fájlt az elkülönített `$Run/scripts/` helyre, hogy a létrejövő `.local/demo-data` is ott maradjon. Add meg a `HERMES_SEED_ADMIN_PASSWORD`, `HERMES_BASE_URL=http://127.0.0.1:5087` és `HERMES_FRONTEND_URL=http://127.0.0.1:5187/` változókat. Futtasd a másolt szkriptet `--with-bookings` argumentummal. A teljes képsorhoz használj új demóadatbázist, mert a 03–06. kép lépései tankolást mentenek.
6. A `HERMES_BROWSER_ADMIN` a helyi `{ "adminPassword": "..." }` alakú fájl útvonala. A `HERMES_BROWSER_ACCOUNTS` a mintaadatbetöltő által készített `bejelentkezesek.json` fájl helye. A próba a külön példány környezeti beállításait használja.

## Futtatás és export

- Az [API-, frontend-, desktop- és böngészős parancsok](../tesztjegyzokonyv.md) mellé a `HERMES_TEST_ADMIN_CONNECTION` a friss tesztklaszter tesztadminjához tartozó kapcsolat. A tesztfixture adatbázist és szerepköröket hoz létre és takarít. A `HERMES_BROWSER_URLS` az eredeti smoke szkripthez `http://127.0.0.1:5187`.
- A képekhez és az ábrákhoz Playwright szükséges. A `HERMES_PLAYWRIGHT_MODULE` egy külön telepített Playwright 1.62.1 `index.mjs` fájljára mutathat. A `HERMES_BROWSER_BINARY` a Brave, Chrome vagy más támogatott Chromium bináris elérési útja. Alapérték a telepített Playwright Chromium.
- A gyökérből a `node docs/thesis-evidence/tools/capture.mjs` az alkalmazás közvetlen felületét vezérli. A `HERMES_EVIDENCE_OUTPUT` külön célkönyvtárat adhat meg. A `--resume-after-fuel` a már mentett 320 km-es demótétel után futtatja újra a 07–12. képek lépéseit.
- Az ábrákhoz külön könyvtárba telepíthető a `mermaid@11.12.0`. A `HERMES_MERMAID_BUNDLE` ennek `node_modules/mermaid/dist/mermaid.min.js` fájljára mutat. A `node docs/thesis-evidence/tools/render-diagrams.mjs` a `.mmd` források mellé írja az SVG-ket.
- A `python docs/thesis-evidence/tools/render-code.py` a Gitből olvassa a rögzített forrást. A kódképekhez Pillow 12.2, Pygments 2.20 és Windows Consolas betűtípus szolgált. Minden `.md` tartalmazza a megfelelő kivágás SHA-256 lenyomatát.
- A `python docs/thesis-evidence/tools/export-test-evidence.py "$Run"` a futás TRX-, JUnit- és böngészőkimeneteiből készíti a TSV-listákat. A segéd a csomag futásainak darabszámait ellenőrzi, és csak az esetneveket és állapotokat exportálja. A képkészítési naplók nevei a szkriptben szerepelnek.

A próba után állítsd le a külön API-t, Vite-ot és PostgreSQL-t.
