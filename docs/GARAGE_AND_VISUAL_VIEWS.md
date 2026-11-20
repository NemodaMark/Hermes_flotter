# Garázs, parkoló és képes nézetek

Állapot: **2026. november 20.**

## Saját autó és hozzáférés

A normál felhasználó kezdőlapján kizárólag a hozzá **jelenleg** hozzárendelt és a `vehicles.read` saját telephelykorlátjával olvasható jármű szerepel. A korábban lezárt hozzárendelés nem számít. Ha nincs ilyen autó, üres állapot jelenik meg; a rendszer nem választ helyette másik céges járművet. A hozzárendelés továbbra sem ad automatikusan olvasási vagy egyéb műveleti jogot.

A járműválasztó a flottaáttekintő jogosultságával rendelkező kezelői nézetben érhető el. Más autók a kezdőlapi kínálatban csak a `vehicles.read` és `vehicles.overview.read` **közös**, jogonként ellenőrzött telephelyein jelenhetnek meg. A már meglévő, külön járműlistához adott olvasási jog nem kerül visszavonásra; a változás a személyes kezdőlap helyettesítő autóválasztását szünteti meg.

Kód: [DashboardManagement.cs](../backend/src/Hermes.Infrastructure/DashboardManagement.cs), [DashboardPage.tsx](../frontend/src/DashboardPage.tsx). A csoportprioritások és az áttekintő saját jogosultsága változatlanok.

## Karosszéria és kameramozgás

A kattintható pontok vetítése a tényleges modell felületére történik, takarásvizsgálattal. Magas furgonoknál az adatpont az oldalfalra kerül, személyautóknál a tetőre; a km-pont a vezetőfülke közelébe, a tankolási pont a megfelelő karosszériarészre. A kiosztás karosszériaarány szerinti közelítés, nem minden gyári típus tanksapkájának pontos digitális másolata. A hátoldalon takart pont és vezetővonala rejtve marad.

Asztali gépen a Tankolás/Km gyorsművelet oldalra nyíló űrlapot kap, enyhébb háttérsötétítéssel. A kamera közben a kiválasztott művelethez fordul; a személyautó és magas furgon tankolási nézete eltér. Mobilon a megszokott, olvasható párbeszédablak marad. Csökkentett mozgás kérésénél az átmenet nem animálódik. A bemutató továbbra is kikapcsolva indul, kézi forgatás és menünyitás leállítja.

Az ellenőrzött jelenlegi modellek nem tartalmaznak kész ajtó-/motorháztető-nyitási animációt. Nem lett a karosszériára pontatlan nyitási animáció ráerőltetve. Később megfelelően tagolt, forgásponttal/animációval szállított modellel ez bővíthető; a jelenlegi geometriaösszevonás a gyermekobjektumos és `articulated` jelölésű elemeket meghagyja külön.

Kód: [vehicleInteractionLayout.ts](../frontend/src/vehicleInteractionLayout.ts), [VehicleStudio.tsx](../frontend/src/VehicleStudio.tsx).

## Passat-kerék javítás

A szállított Passat egyik oldalának kerekei már a forrásjelenetben is hiányoztak. A javítás az ép oldal eredeti kerék-háromszögeit, anyagait és UV-koordinátáit tükrözi a hiányos oldalra, fordított lapiránnyal. A jármű stílusa megmarad, a többi modellhez nem ad hozzá alkatrészt. A javítás egyszer, betöltéskor fut, majd a szokásos anyagonkénti összevonás optimalizálja. Mindkét tengely mindkét oldalát a tényleges GLB-n raycast regressziós ellenőrzés vizsgálja.

Kód: [vehicleModelRepairs.ts](../frontend/src/vehicleModelRepairs.ts). Az eredeti CC BY kredit megmarad: [modelllicencek](../frontend/public/models/studio/LICENSE.md). A javítás nem módosítja a jármű üzleti adatait és nem állítja, hogy minden illusztráció pontos gyári típusmodell.

## Flottaparkoló

A **Járművek → Parkoló** választó a megszokott keresésre, állapot- és telephelyszűrésre, szerveroldali lapozásra épül. A lista nézet egy gombbal visszaállítható. A parkolóban a jármű és az alatta lévő rendszámra kattintás is a jármű adatlapját nyitja meg, amelyről a 3D garázs külön is elérhető.

A környezet saját, könnyű Three.js jelenet, a HERMES garázs meglévő anyagaival és procedurális felületi textúrájával. A felhasználó által ötletként megadott Sketchfab parkoló nem lett letöltve vagy beépítve. Az autók a már meglévő, kredittel szállított modellek, a tárolt színnel. Az API a szűrt járműlista részeként minimális `bodyType` és `color` mezőt is visszaad, nem kér le külön adatlapot minden autóhoz.

A készülék helyi órája alapján a megjelenítés hajnalban (05–07), nappal (07–17), alkonyatkor (17–20), illetve éjszaka (20–05) eltérő világítást használ. Ez hangulati megjelenítés, nem napállás-szimuláció vagy telephelyi csillagászati számítás. Az aktuális órát percenként ellenőrzi.

Terheléskorlátok:

- Egyetlen WebGL vászon, asztalon legfeljebb négy modell oldalanként; keskeny kijelzőn vagy legfeljebb négy logikai processzor jelzésekor legfeljebb kettő.
- A modellek sorban töltődnek be. Másik oldal/navigáció elengedi a geometriát, anyagokat, textúrákat, vezérlőket és eseménykezelőket.
- Nincs folyamatos automatikus kameramozgás, dinamikus árnyéktérkép vagy folyamatos képkockahurok. Álló kameránál nem rajzol újra; rejtett böngészőlapon sem rajzol.
- Legfeljebb 800 000 belső képpont és 1,2-es pixelsűrűség. A járművek alatt a garázséval közös olcsó kontaktárnyék szerepel.
- WebGL- vagy modellbetöltési hiba esetén a rendszámokból továbbra is megnyitható az adatlap, és a lista nézet használható.

Ez korlátozza a terhelést, de ismeretlen eszközön nem jelent garantált 60 FPS-t. A böngészős ellenőrzés az álló parkolóban **0 új draw callt** mért 800 ms alatt. Mozgás közbeni FPS-célhoz a végleges célgépeken kell GPU-profilt mérni.

Kód: [FleetParking.tsx](../frontend/src/FleetParking.tsx), [parkingEnvironment.ts](../frontend/src/parkingEnvironment.ts).

## Felhasználók és telephelyek

A felhasználólista **Portrék** nézete a meglévő, jogosultan megtekinthető profilképeket és profiladatokat használja, képhiánynál monogrammal. A cégadatlap **Telephelyek → Helyszínek** nézete a telephelykódot, címet, állapotot, kapcsolattartót és a jogosultan látható járműdarabszámot jeleníti meg. A grafikus telephelyjelzés illusztráció, nem valós alaprajz vagy helyszínfotó.

A lista mindkét helyen megmarad. Nincs új külső lekérdezés, képgenerálás vagy új jogosultsági kiskapu. A telephely szerkesztési/archiválási gombjait az adott telephely saját műveleti jogai szabályozzák. A cégtől független összes felhasználó nézet továbbra is `system.manage` joghoz kötött. A kép- és lista nézet közös kapcsolókomponenst és meglévő HERMES design tokeneket használ.


## Ellenőrzés – 2026. november 20.

- Teljes PostgreSQL-es backendcsomag: **220 sikeres teszt**, benne saját/idegen hozzárendelés, visszavont hozzárendelés, olvasási és áttekintési telephelyjogok metszete, illetve az engedélyezett parkolási megjelenítési adatok.
- Teljes frontendcsomag: **200 sikeres teszt**, továbbá a végső célzott futtatásban 25 garázs-/nézetteszt sikeres. A nagy GLB-k vizsgálata `--maxWorkers=2 --testTimeout=20000` beállítással futott.
- Lint és production build sikeres; a korábban is nagy Three.js/modellnézeti csomagra a Vite méretfigyelmeztetést ad.
- Chromium/Brave böngészős ellenőrzés: 1440×900, 768×900, 390×844 és 867×400. Saját autó, autóválasztó hiánya normál fióknál, oldalra nyíló asztali rögzítés, lista/parkoló, portrék, telephelynézet és mobil navigáció kipróbálva. Vízszintes kilógás és JavaScript-hiba nem jelentkezett.
- Mind a négy napszak megjelenítése ellenőrizve. Egyetlen parkolási vászon; asztalon 4, mobilon 2 autó; álló nézetben 800 ms alatt 0 új draw call.
- A futó helyi backend újraépítve és újraindítva, adatbázismigráció nem szükséges. Valódi demósofőrrel a saját hozzárendelések és a minimális listamegjelenítési mezők ellenőrizve. Meglévő járműadat vagy hozzárendelés nem lett átírva.
