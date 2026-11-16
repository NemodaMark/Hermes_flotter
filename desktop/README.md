# HERMES rendszervezérlő

Natív Windows-alkalmazás .NET 10 és WPF alapon a helyi fejlesztői környezethez. A backend, a Vite frontend és a helyi PostgreSQL figyelhető és újraindítható belőle. A vezérlő külön projekt, a webes frontend működésétől független.

A [munkaállomás-telepítők](../docs/MUNKAALLOMAS_TELEPITES.md) a teljes projektet és az asztali indítót is előkészítik. Linuxon a terminálos indító ugyanazt a .NET-es állapotellenőrzést használja.

## Indítás

A projekt gyökerében:

```powershell
./scripts/start-control-center.ps1 -CreateShortcut
```

A script .NET 10 SDK-val Windows x64-re, saját .NET futtatókörnyezettel csomagolja az alkalmazást, elindítja, és a `-CreateShortcut` kapcsolóval létrehozza a **HERMES Rendszervezérlő** asztali parancsikont. A csomagolt alkalmazás elindításához külön Desktop Runtime nem szükséges. A backend újrafordításához továbbra is .NET 10 SDK, a frontendhez Node.js és az `npm ci` által telepített függőségek kellenek. Git és Windows PowerShell is szükséges.

A `-NoLaunch` kapcsoló csak csomagol. A kiadások külön `.local/control-center/releases/<id>` mappát kapnak, így a régebbi szolgáltatásgazdák futása nem akadályozza az új vezérlő fordítását. Ezt a mappát ne töröld, amíg az abból indított vezérlő vagy szolgáltatásgazda fut.

Közvetlen indításkor a projektmappa megadható: `Hermes.ControlCenter.exe --root "C:\projektek\HERMES"`. Egy projekthez egy vezérlőablak nyitható.

## Állapotok és folyamatok

Öt másodpercenként frissülnek a szolgáltatásadatok:

- Backend: a `/health/live` és `/health/ready` tényleges válasza; a ready az adatbázist és a migrációkat is ellenőrzi.
- Frontend: sikeres HTTP-válasz és a HERMES HTML-oldal felismerése.
- PostgreSQL: hitelesített `hermes_app` kapcsolat a `hermes` adatbázishoz és `SELECT 1`.
- Windows-folyamatok: saját PID, szülő PID, futási idő, memória és a mintavételek közötti CPU-használat. A memória munkakészlet, a PostgreSQL összesített értéke megosztott lapokat is tartalmazhat.

A futó folyamat és a sikeres health két külön adat. Ha a végpont elérhető, de nem azonosítható hozzá saját folyamat, a vezérlő ezt külső folyamatként jelzi. A folyamattábla a saját API-t, Vite-ot, a kiválasztott PostgreSQL-példány gyermekfolyamatait és a vezérlő szolgáltatásgazdáit mutatja.

## Git és futó verzió

A helyi ág, HEAD, commitüzenet és módosított munkafa külön jelenik meg az upstream ág commitjától. A vezérlő induláskor, majd percenként `git fetch --no-tags` ellenőrzést végez a követett tárolón. A **GitHub ellenőrzése** gomb ugyanezt indítja kézzel. Látható a helyi/távoli commitkülönbség és az utolsó sikeres ellenőrzés ideje. Hálózati vagy hitelesítési hibánál a távoli verzió utoljára ismert állapotként szerepel.

A fetch nem végez pullt, checkoutot vagy resetet, és nem írja át a projektfájlokat. A Git a gépen meglévő hitelesítést használja; a vezérlő nem kér és nem tárol GitHub-tokent.

A backend `/health/version` végpontja a ténylegesen betöltött assembly verzióját és Git-commitját, fordítási idejét, folyamatindulását és PID-jét közli. Ez eltérhet a jelenlegi HEAD-től. A vezérlőből végzett fordítás a módosított munkafa jelzését is beégeti a buildbe. Más fordításnál a forrás módosítottsága ismeretlen lehet, ezt a felület jelzi. A Vite élő munkafát szolgál ki; nála az induló commit csak tájékoztató adat, a vezérlőből indított folyamatnál rögzítve.

## Újraindítás és naplók

Az egyedi **Újraindítás** gomb leállt szolgáltatást is elindít. A teljes rendszer újraindítása a függőségek sorrendjében történik: PostgreSQL → backend → frontend.

- Backend: a projekt saját folyamatának leállítása, a port felszabadulásának megvárása, Debug-fordítás, indítás, majd ready-ellenőrzés. A fordítási és indítási hibák a vezérlő eseményei között szerepelnek.
- Frontend: a saját Vite-folyamat leállítása és újraindítása a beállított porton.
- PostgreSQL: a beállított adatmappához tartozó `pg_ctl start/restart -m fast`, újrainicializálás és adattörlés nélkül. A restart megszakítja az aktív kapcsolatokat és visszagörgeti a nyitott tranzakciókat.

A vezérlő leállítás előtt újra ellenőrzi a folyamat elérési útját, PID-jét és indulási idejét. Nem állít le minden `node`, `dotnet` vagy `postgres` folyamatot név alapján. Idegen folyamattal foglalt portnál hibát jelez.

A háttérben külön szolgáltatásgazdák vezetik a backend és a frontend kimenetét, ezért az ablak bezárása után a szolgáltatások tovább futnak. A naplók és a helyi futási adatok a Gitből kizárt `.local/control-center` mappában vannak. A felület a legutóbbi 150 szolgáltatásnapló-sort mutatja. A vezérlő-, backend- és frontendnaplók 3 MB felett egy előző fájlt megtartva fordulnak át; a PostgreSQL kimenete külön fájlban gyűlik. A korábban, más terminálból indított folyamatok múltbeli kimenete nem kérhető vissza; a rögzítés a vezérlőből történő indítástól kezdődik.

## Beállítások és határok

Az első indítás létrehozza a `.local/control-center/settings.json` fájlt. A **Beállítások** gomb megnyitja szerkesztésre; módosítás után indítsd újra a vezérlőablakot. A [minta](settings.example.json) mutatja a mezőket.

Ezen a gépen a vezérlő felismeri a korábban előkészített, felhasználói HERMES-eszközmappában lévő SDK-t és PostgreSQL-t, a futó adatbázis portját pedig a saját PID-fájljából olvassa. Másik gépen add meg a PostgreSQL bin- és adatmappáját, szükség esetén a futtatókörnyezetek elérési útját. A jelszó a gyökér `.env` fájl `POSTGRES_APP_PASSWORD` értéke; nem kerül a settings fájlba vagy a folyamatok parancssorába. Az ismert jelszóértékeket a vezérlő kitakarja a saját naplóiból.

Ez a verzió helyi, natív fejlesztői folyamatokat kezel. Docker-konténerek és Windows-szolgáltatásként telepített PostgreSQL vezérléséhez külön adapter szükséges; ezekhez nem végez kényszerített folyamatleállítást. A vezérlő nem futtat migrációt és nem telepít GitHub-frissítést automatikusan.

## Ellenőrzés

```powershell
dotnet test desktop/tests/Hermes.ControlCenter.Tests/Hermes.ControlCenter.Tests.csproj -c Release
dotnet build desktop/Hermes.ControlCenter.slnx -c Release
```

A core tesztjei Windows és Linux alatt is futnak; a WPF-alkalmazást Windows alatt kell fordítani és használni. A GitHub Actions mindkét tesztkörnyezetet és a Windows-csomagolást ellenőrzi.

A használt platformok leírása: [Microsoft WPF](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/), [PostgreSQL pg_ctl](https://www.postgresql.org/docs/current/app-pg-ctl.html), [Git fetch](https://git-scm.com/docs/git-fetch).
