# Ábrajegyzék

A képfájlok eredeti felbontásban érhetők el. Az ábracímeket a dolgozat fejezetszámozásához lehet igazítani.

## Tervábrák

| Javasolt cím és fejezet | Ábrázolt tartalom és a tervezési döntés | Formátum |
| --- | --- | --- |
| **A HERMES rendszerarchitektúrája** · Rendszertervezés | A kliens, az API projektjei, az adatbázis és a külső integrációk kapcsolata. A helyi Vite proxy és a Caddy/nginx útvonal a két dokumentált üzemmódot mutatja. Az adatbázist külön migrációs futtatás módosítja. A Windows vezérlőközpont önálló üzemeltetői segéd, a fő alkalmazás kérésútvonalán kívül. [Program.cs](../../backend/src/Hermes.Api/Program.cs), [Vite](../../frontend/vite.config.ts), [Caddy](../../deploy/debian13/Caddyfile), [nginx](../../frontend/nginx.conf) | [Forrás](diagrams/01-architektura.mmd) · [SVG](diagrams/01-architektura.svg) |
| **A céges jogosultság és a flotta fő adatkapcsolatai** · Adatbázisterv | Válogatott ER-nézet. A cég és jogosultság körét, a jármű fő kapcsolatait és a személyi km-hierarchiát emeli ki. A pontozott Identity-kapcsolat logikai `UserSubject`-hivatkozás. Az FK jelölés több mezőnél egy összetett kulcs részét jelenti. A dokumentum három opcionális kapcsolata közül pontosan egy kötelező, ezt adatbázis-korlát ellenőrzi. A csoport-hozzárendelés további táblái, naplók, technikai Identity-táblák és a teljes oszloplista az ábra hatókörén kívül maradnak. [Alapmodell](../../backend/src/Hermes.Infrastructure/HermesDbContext.cs), [mileage](../../backend/src/Hermes.Infrastructure/MileageModel.cs), [okmány](../../backend/src/Hermes.Infrastructure/DocumentModel.cs) | [Forrás](diagrams/02-adatmodell.mmd) · [SVG](diagrams/02-adatmodell.svg) |
| **Tankolás és közös járműműveletek UML-osztálynézete** · Backendterv | Az üzleti feldolgozás, a céges tranzakció, a jogosultsági szűrés és a mentett entitások viszonya. A nyilak a konstruktor-, hívási vagy `DbSet`-kapcsolatokat jelölik a felirat szerint. A partial `FleetManagement` egy osztályként szerepel. A kiválasztott tagok mutatják a felelősségek elosztását. [FleetManagement](../../backend/src/Hermes.Infrastructure/FleetManagement.cs), [példányosított műveletek](../../backend/src/Hermes.Infrastructure/FleetOperations.cs), [MileageLedger](../../backend/src/Hermes.Infrastructure/MileageManagement.cs) | [Forrás](diagrams/03-uml-osztalyok.mmd) · [SVG](diagrams/03-uml-osztalyok.svg) |
| **Tankolás szekvenciája automatikus személyes km-elszámolással** · Megvalósítás | A dátum- és óraállásváltozástól a járműlista-frissítésig követi az alkalmazás adatáramlását. Külön szerepel az előnézeti validáció és a régi előnézeti értékre adott konfliktus. A döntés lényege a szerveroldali újraszámítás és a közös tranzakció. A 400-as és sikeres ág böngészőben futott. A 409-es ágat az integrációs teszt ellenőrzi. [API](../../backend/src/Hermes.Api/FleetOperationsEndpoints.cs), [kliens](../../frontend/src/VehicleOperations.tsx), [teszt](code/08-integracios-teszt.md) | [Forrás](diagrams/04-uml-szekvencia.mmd) · [SVG](diagrams/04-uml-szekvencia.svg) |

## Alkalmazásképek

A képeken a külön Development példány fiktív Demo Flottája látható. A szerepkör minden felvételnél az elkülönített rendszerkezelői demófiók, a mintacéghez elérhető teljes műveletkörrel. A mobilkép érintős emuláció, a többi felvétel 1440 × 960 pixeles. A 03–06. és 11. kép egy folyamat állapotait mutatja be.

### 01. Céges flottaáttekintő

**Fájl** [01-flotta-attekinto.png](screenshots/01-flotta-attekinto.png) · **Útvonal** `/#/dashboard` · **Javasolt fejezet** Kezdőlap és vezetői áttekintés.

**Előállítás.** Jelentkezz be, válaszd a Demo Flottát, és nyisd meg a Kezdőlap áttekintő nézetét.

**Üzleti helyzet.** A járműállapotok, határidők és futásteljesítmény külön helyen történő keresése nehézkessé teszi a napi áttekintést.

**Dolgozatba illeszthető leírás.** A kezdőlapon a 30 járműves mintaflotta állapota, a havi óraálláskülönbségek és a szervizhez kötődő teendők közös nézetbe kerülnek. A számlálók a kiválasztott cég és a felhasználó által látható adatkör szerint értelmezhetők.

### 02. Járműlista kereséssel, szűréssel és állapotjelzéssel

**Fájl** [02-jarmulista.png](screenshots/02-jarmulista.png) · **Útvonal** `/#/vehicles` · **Javasolt fejezet** Járműnyilvántartás.

**Előállítás.** Nyisd meg a Járművek menüt. Válaszd a Lista nézetet és a Minden állapot szűrőt.

**Üzleti helyzet.** A rendszám, típus és állapot alapján történő egységes rákeresés gyorsabb hozzáférést ad a járműadatlaphoz.

**Dolgozatba illeszthető leírás.** A járműlista elsődleges azonosítóként a rendszámot mutatja. A táblázat sorai az aktuális óraállást és állapotot is tartalmazzák. A kereső és az állapotszűrő ugyanerről a felületről érhető el.

### 03. Járműadatlap, alapadatok és azonnali teendők

**Fájl** [03-jarmuadatlap.png](screenshots/03-jarmuadatlap.png) · **Útvonal** `/#/vehicles` · **Javasolt fejezet** Járműadatlap és navigáció.

**Előállítás.** A listán kattints a DEMO-001 rendszámra, és maradj az Áttekintés aloldalon. A folyamatképekben ez a tankolás előtti állapot.

**Üzleti helyzet.** A jármű állapotára, különböző irataira és teendőire vonatkozó információ egyetlen kiindulópontot igényel.

**Dolgozatba illeszthető leírás.** Az adatlap együtt mutatja az azonosító és üzemeltetési alapadatokat, a kilométerállást és az aktuális határidőket. A külön navigáció a használati, szerviz- és elszámolási műveletekhez vezet.

### 04. Jövőbeli tankolási dátum elutasítása

**Fájl** [04-tankolas-validacio.png](screenshots/04-tankolas-validacio.png) · **Útvonal** `/#/vehicles` · **Javasolt fejezet** Validáció és hibakezelés.

**Előállítás.** DEMO-001 → Tankolás. Maradjon aktív a km- és magánhasználat elszámolása, majd add meg a következő naptári napot. Várd meg a szerveroldali előnézet válaszát.

**Üzleti helyzet.** A későbbi dátummal elmentett tétel rossz időszakot és valótlan fogyasztási előzményt hozhatna létre.

**Dolgozatba illeszthető leírás.** A jövőbeli dátumot az előnézeti végpont elutasítja. A képen megjelenik a szerver üzenete, és a mentés inaktív. A munkafolyamat a dátum helyesbítésével folytatható.

### 05. Tankolási űrlap és a kiszámított személyes távolság

**Fájl** [05-tankolas-adatbevitel.png](screenshots/05-tankolas-adatbevitel.png) · **Útvonal** `/#/vehicles` · **Javasolt fejezet** Tankolás megvalósítása.

**Előállítás.** Állítsd vissza a mai napot, és adj meg 18 670 km-t, 38,5 litert, teletankot és 40 km magánhasználatot. Várd meg a 320 km-es előnézetet.

**Üzleti helyzet.** A teljes megtett út és a magánrész kétszeri kézi kiszámítása külön hibaforrás lehet.

**Dolgozatba illeszthető leírás.** Az automatikus előnézet a korábbi 18 350 km és az új állás különbségéből ebben az esetben 320 km elszámolható távolságot állapít meg. A felhasználónak a magánrészt kell megadnia, az elszámolható összeget a szerver szolgáltatja.

### 06. Elmentett tankolás a jármű havi listájában

**Fájl** [06-tankolas-eredmeny.png](screenshots/06-tankolas-eredmeny.png) · **Útvonal** `/#/vehicles` · **Javasolt fejezet** Tankolás megvalósítása.

**Előállítás.** Mentsd az előző űrlapot, majd a DEMO-001 adatlapon nyisd meg a Tankolás és km aloldalt.

**Üzleti helyzet.** A beküldött tételnek visszakereshetőnek kell lennie az érintett jármű történetében.

**Dolgozatba illeszthető leírás.** A havi listában a 38,5 liter és az új állás megjelenése igazolja a betöltött mentett tételt. A sorhoz tartozó műveletek lehetőséget adnak indokolt korrekcióra vagy érvénytelenítésre.

### 07. Jármű szervizhatárideje és korábbi munkalapja

**Fájl** [07-szervizelozmenyek.png](screenshots/07-szervizelozmenyek.png) · **Útvonal** `/#/vehicles` · **Javasolt fejezet** Szervizfolyamat.

**Előállítás.** DEMO-001 → Szerviz és iratok → Szerviz és időpontok. Várd meg a Demo Központi Szerviz bejegyzéseit.

**Üzleti helyzet.** A tervezett következő időpont és a korábbi szervizmunka gyakran eltérő adatforrásokban található.

**Dolgozatba illeszthető leírás.** A szerviznézet elválasztva tartalmazza a határidőt, a tervezett időpontot és az elvégzett munkát. Az előzmény azonosítható a munkalapszám, az elvégzés időpontja és a szolgáltató alapján.

### 08. Járműokmány megnyitása alkalmazáson belüli PDF-előnézetben

**Fájl** [08-dokumentumelonezet.png](screenshots/08-dokumentumelonezet.png) · **Útvonal** `/#/vehicles` · **Javasolt fejezet** Fájlkezelés és jogosultság.

**Előállítás.** DEMO-001 → Szerviz és iratok → Járműokmányok. Forgalmi engedély kategóriába töltsd fel a hermes-minta-forgalmi.pdf fájlt, majd válaszd a megtekintést. A képkészítő a fiktív PDF-et előállítja.

**Üzleti helyzet.** A dokumentum előkeresése és ellenőrzése közvetlenül az érintett rekord mellett egyszerűbb.

**Dolgozatba illeszthető leírás.** A megjelenítő a szerveren tárolt, jogosultsággal olvasható teszt-PDF első oldalát jeleníti meg. A fejléc a dokumentumot, a járművet és a műveleteket jelzi.

### 09. Havi eseményszabály a teljes flottára

**Fájl** [09-ismetlodoflottaesemeny.png](screenshots/09-ismetlodoflottaesemeny.png) · **Útvonal** `/#/vehicles` · **Javasolt fejezet** Események és időzítés.

**Előállítás.** Járművek → Események → Új esemény. Válaszd a Minden jármű és Havonta opciót, majd mentsd a Kötelező havi elszámolás · minta nevű szabályt.

**Üzleti helyzet.** Ismétlődő havi teendők kézi felvétele következetlen naptárat eredményezhet.

**Dolgozatba illeszthető leírás.** A havi eseménylistán a mentett szabály megjelenése mutatja a cégszintű hatókört és az ismétlődést. Az előfordulás a mentett szabályból számolódik a kiválasztott hónapra.

### 10. Műveleti jogcsomag és kiválasztott telephelyek

**Fájl** [10-jogosultsagcsoport.png](screenshots/10-jogosultsagcsoport.png) · **Útvonal** `/#/permission-groups` · **Javasolt fejezet** Hozzáférés-kezelés.

**Előállítás.** Beállítások → Jogosultságcsoportok. Nyisd meg a Demo – Budapesti szerviz csoport szerkesztését, és nézd meg a cég melletti telephelyi kört.

**Üzleti helyzet.** Ugyanazt a műveletet a különböző földrajzi egységekben eltérő személyek végezhetik.

**Dolgozatba illeszthető leírás.** A kiválasztott jogcsomaghoz céges hatókör és külön telephelylista rendelhető. A szerver a kért művelet jogát és annak érvényes telephelyét vizsgálja a járműhöz való hozzáféréskor.

### 11. Saját havi km-állás a felhasználói profilon

**Fájl** [11-szemelyes-km-profil.png](screenshots/11-szemelyes-km-profil.png) · **Útvonal** `/#/profile/admin` · **Javasolt fejezet** Személyes kilométerkeret.

**Előállítás.** A tankolás mentése után nyisd meg a saját profilt. Ellenőrizd az Aktuális havi km-állás kártyát.

**Üzleti helyzet.** A több autóval megtett út összesítésekor a szükséges bontás felhasználóhoz kötődik.

**Dolgozatba illeszthető leírás.** Az aktuális hónapra a profil 320 km teljes utat mutat, ebből 40 km magánhasználat és 280 km céges használat. A minta így a jármű szintű tankolási sor és a felhasználói összesítés különbségét szemlélteti.

### 12. Járműadatlap mobilon, alsó műveletsorral

**Fájl** [12-mobil-jarmuadatlap.png](screenshots/12-mobil-jarmuadatlap.png) · **Útvonal** `/#/vehicles` · **Javasolt fejezet** Reszponzív kezelőfelület.

**Előállítás.** 390 × 844 CSS pixeles érintős böngészőnézetben nyisd meg a DEMO-001 adatlapját. Hagyd nyitva az Áttekintés részt.

**Üzleti helyzet.** A gyakori rögzítési műveleteknek keskeny érintőképernyőn is elérhetőnek kell maradniuk.

**Dolgozatba illeszthető leírás.** A járműadatlap mobilon függőlegesen rendeződik, az aloldalválasztó lenyitható. A tankolás és a km-rögzítés az alsó műveletsorból elérhető. A kép emulált mobilméretben készült.

## Kódábrák

A címre kattintva az ábra, a másolható kód, a forrássorok és a magyarázat együtt nyílik meg.

| Ábra | Javasolt fejezet |
| --- | --- |
| [Céges kontextus a PostgreSQL-tranzakcióban](code/01-ceges-tranzakcio.md) · [PNG](code/01-ceges-tranzakcio.png) | Céges adatelkülönítés |
| [Járművek szűrése az adott műveleti jog telephelyei szerint](code/02-telephelyszures.md) · [PNG](code/02-telephelyszures.png) | Céges adatelkülönítés |
| [Tankolás és automatikus km-tétel közös mentése](code/03-tankolas-mentes.md) · [PNG](code/03-tankolas-mentes.png) | Tankolási munkafolyamat |
| [Tétel hozzáfűzése a felhasználó havi km-elszámolásához](code/04-szemelyes-km.md) · [PNG](code/04-szemelyes-km.png) | Személyes kilométer-nyilvántartás |
| [Fájlfogadás és jogosultság újraellenőrzése dokumentumfeltöltéskor](code/05-dokumentum.md) · [PNG](code/05-dokumentum.png) | Szerviz és okmánykezelés |
| [Ismétlődő dátumok számítása adott időablakra](code/06-esemeny-ismetles.md) · [PNG](code/06-esemeny-ismetles.png) | Flottaesemények |
| [Tankolási előnézet, mentés és lekérdezések frissítése Reactben](code/07-frontend-tankolas.md) · [PNG](code/07-frontend-tankolas.png) | Webes kliens és validáció |
| [Automatikus km-előnézet és mentés jogosultsági határesetei](code/08-integracios-teszt.md) · [PNG](code/08-integracios-teszt.png) | Automatizált ellenőrzések |
