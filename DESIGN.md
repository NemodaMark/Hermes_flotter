---
version: alpha
name: HERMES
description: Céges flottakezelés, gyors napi rögzítéssel és áttekinthető járműadatokkal.
colors:
  ground: "#fffefa"
  ink: "#242821"
  muted: "#60675c"
  signal: "#344b3c"
typography:
  display:
    fontFamily: IBM Plex Sans
    fontSize: 26px
    fontWeight: 600
  body:
    fontFamily: IBM Plex Sans
    fontSize: 14px
    lineHeight: 1.5
rounded:
  sm: 7px
  md: 12px
spacing:
  sm: 8px
  md: 16px
  lg: 24px
---

# HERMES felületi szerződés

Frissítve: **2026. november 23.** A dokumentum a meglévő arculatot rögzíti; az alapértékek forrása a kód, nem egy második téma.

## Alapok és színek

A flottakezelőben a tankolás és kilométerállás gyors rögzítése, valamint a járműadatok és teendők kezelése az elsődleges. A saját autó garázsa látványos belépési pont; a munkapanelek elrendezését az adott feladat határozza meg.

Minden felület a `--surface`, `--ink`, `--muted`, `--line`, `--primary` és szemantikus állapottokeneket használja. A sötét mód a böngésző beállítását követi. A háttér `#1b1b1b`, az alapfelület `#252525`, a szöveg `#f0f0f0`, az akcentus `#dddddd`. A jármű festése és a hiba, figyelmeztetés, siker állapotszínei a saját színüket használják.

Források: [téma](frontend/src/fleet-theme.css), [közös UI](frontend/src/ui/sera.css), [tipográfia és fókusz](frontend/src/index.css), [járműelrendezés](frontend/src/vehicle-profile.css).

## Tipográfia és elrendezés

Az IBM Plex Sans 400/500/600 súlyai maradnak. A rendszám a jármű elsődleges felirata; a címkék kisebbek és visszafogottabbak az értékeknél.

A teljes járműadatlap öt területre oszlik: **Áttekintés**, **Tankolás és km**, **Használat**, **Szerviz és iratok**, **Előzmények**. Asztalon bal oldali navigáció, mobilon ugyanennek egyetlen kinyitható menüje jelenik meg. Szerkesztés közben csak a meglévő mezőcsoportos szerkesztő navigációja aktív.

A rendszám, gyártó/modell, állapot, aktuális km, telephely és használó tömör fejlécbe kerül. A megtekintési állapot címke–érték párokat mutat; beviteli mezők csak kifejezett szerkesztés után jelennek meg. A garázs panelje egyetlen feladatot tartalmaz, teljes profilnavigáció nélkül.

## Felületek és közös komponensek

Egy munkafelület egy közös keretet kap. A mezőket és ritkább részleteket vonal, térköz vagy kinyitható rész választja el; nem készül minden információ köré új kártya. A közös vezérlő- és panelrádiusz megmarad, új dekoratív árnyék nem kerül be.

A `Button`, `Select`/`ComboBox`, `Toggle`, `AccessDialog`, `QueryMessage`, `PageButtons`, `VehicleRecordingActions` és meglévő üzleti komponensek az elsődleges építőelemek. A `VehicleTaskContent` közös feladattartalmat ad a teljes adatlap és garázs számára.

A `VehicleDetailGroup` tartalmi kinyitásra szolgál. A menükhöz használt `ui/Disclosure` gyermekműveletre bezáródik, ezért űrlaptartalom köré nem alkalmas.

## Mobil és hozzáférhetőség

- A Tankolás és Km rögzítése ugyanazon gombjai mobilon rögzített alsó sávba kerülnek; nincs második példány.
- A tartalom helyet hagy az alsó sávnak és az eszköz biztonsági margójának.
- A garázsfeladat mobilon teljes szélességű párbeszédablak, saját görgetéssel és bezárógombbal.
- A fő hamburger menü natív modális, jobbról nyíló offcanvas panel. Egyetlen navigációt használ; a fókusz a panelen belül marad, bezárás után visszatér a megnyitó gombra.
- A navigáció billentyűzettel használható, látható fókuszt és aktuális állapotot kap. Menüválasztás után a mobil menügomb visszakapja a fókuszt.
- A meglévő csökkentettmozgás-beállítás, témák és hibaállapotok megmaradnak.

## Megőrzendő szabályok

Nincs új színpaletta, betűcsalád vagy párhuzamos UI-könyvtár. Nincs ismétlődő járműfejléc, egymásba ágyazott fülsor, megtekintéskor letiltott űrlap, üres listán lapozósáv vagy kikapcsolt foglalásnál üres naptár. A korábbi foglalások ettől még elérhetők.

Az elrendezés nem ad új jogot: a tényleges jármű műveletenkénti jogosultsága elsőbbséget élvez a céges összesítéssel szemben. A szerveroldali cég-/telephelykorlátok, verzióellenőrzés és naplózás változatlanok.

## Garázs HUD

Bal felül a rendszám, modell és kattintható km-állás; jobb felül a kameravezérlés, alatta a két legsürgősebb teendő; bal alul a napi gyorsműveletek. A teljes teendőlista külön párbeszédablakból érhető el. Nincs belső görgetős értesítésfal vagy megismételt telephely-/karosszéria-/színsor. A modell licence külön hivatkozásként megmarad.

Mobilon a kamera összecsukható eszköztár, a tankolás/km pedig külön, jól olvasható első gombsor. A nyugtafotó-választó natív fájlinputot használ, magyar felirattal és látható fájlnévvel. A jelölőnégyzetek a közös akcentust követik, kényszerített rendszerszíneknél natív megjelenítéssel.

## Kezdőlap

Az **Áttekintő** alapértelmezése a flotta összegzése. Szerkesztéskor a modulválasztóból húzással vagy kattintással adható hozzá modul vagy jegyzet. A teljes rács használható lerakásra, és a körvonal előre jelzi a modul helyét. A modulok helye és közöttük az üres tér mentés után is megmarad. A fogantyút húzással és fókuszban a nyílbillentyűkkel is lehet mozgatni. A kártyák a jobb alsó fogantyúval vagy a beállításokban méretezhetők. Asztalon 3–12 rácsoszlopból választható a szélesség. Mobilon és keskeny nézetben a mentett kártyák egy oszlopban jelennek meg, és az elrendezés csak megtekinthető. Az alapelrendezés visszaállítása törli a mentett elrendezést és a benne lévő jegyzeteket. Az elrendezés és a legutóbbi telephely felhasználónként és cégenként a helyi böngészőben tárolódik. A flottaadatokat a szerver az adott művelet jogosultsága alapján szűri. Flottaáttekintő jog nélkül az Autós kezdőnézetből a Saját áttekintő jogosult moduljai érhetők el.

Az oszlop-, kör- és pontdiagram az adatforrástól függetlenül választható. A kilométeradatok havi, negyedéves vagy éves bontásban, a beállított időszakra jelennek meg. A flotta futását a járművek óraállásai, a személyenkénti futást a rögzített havi km-elszámolások adják. Az utóbbi diagram nézetében a céges km-kezelő egy vagy több munkatársat is kiválaszthat. Az egyéni szűrés az aktuális nézetre érvényes. A saját km-elszámolási jog a saját összesítőhöz elegendő.
