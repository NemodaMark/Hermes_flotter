# Járműadatlap és garázsfeladatok

Állapot: **2026. november 23.**

## Elrendezés

A hosszú fülsor, belső mezőcsoport-navigáció és megismételt használóadatok helyett öt fő terület készült. A garázs ugyanazokat az üzleti komponenseket használja, de mindig csak a kiválasztott feladatot nyitja meg.

| Terület | Elérhető tartalom |
| --- | --- |
| Áttekintés | Aktuális teendők, fontos azonosító- és járműadatok, kinyitható műszaki/üzemeltetési adatok, rögzítési metaadatok, képek |
| Tankolás és km | Tankolások, fogyasztás és havi összesítés, bizonylatok, javítás/érvénytelenítés, CSV-export, km-előzmények, saját havi elszámolás és keret |
| Használat | Használó- és telephely-hozzárendelés, foglalás, átadás-átvétel; a korábbi használók az Előzményekben érhetők el |
| Szerviz és iratok | Határidők, szervizbejegyzések és időpontok, járműokmányok, lízingszerződések és csatolmányaik |
| Előzmények | Szűrővel kiválasztható kilométerállások, használók, rendszámok és jogosultság esetén módosítási napló |

A **Saját havi elszámolás és keret** a meglévő személyes, céghez tartozó elszámolás, nem kizárólag az éppen megnyitott autó kimutatása.

## Megtekintés és szerkesztés

A fejlécben egyszer jelenik meg a rendszám, gyártó/modell, állapot, kilométerállás, telephely és aktuális használó. A megtekintési nézet olvasható értékeket mutat. Az országkód az Üzemeltetés részben is megtalálható.

A **Szerkesztés** külön állapotot nyit a meglévő négy mezőcsoporttal és validációval. Közben csak a szerkesztő navigációja látszik. A felvétel és szerkesztés közös `VehicleFields` mezőkészlete, kötelező mezői és tanuló gyártó/modell-javaslatai megmaradtak.

A szerkesztés elején rögzített adatverziót háttérfrissítés nem írja át. Ha időközben más módosította az autót, a szerver meglévő `409` válasza megjelenik, a beírt adatok megmaradnak. A Mégse csak nem mentett változtatásoknál kér elvetési megerősítést. Böngészőoldal bezárásánál/frissítésénél a szokásos nem mentett változás figyelmeztetés működik.

## Garázs és mobil

A [VehicleTaskPanel](../frontend/src/VehicleTaskPanel.tsx) csak az adott autó engedélyezett feladatát tölti be. Az adatpanelben nincs teljes profilnavigáció, szerkesztő vagy ismétlődő tankolás/km-gombsor. A **Teljes járműadatlap** külön útvonalra visz.

Asztalon a panel a feladat helyigényéhez igazodik: az adatok keskenyebb, a foglalások és összetettebb bejegyzések szélesebb panelt kapnak. Mobilon a feladat a teljes nézetet használja. A natív párbeszédablak fókuszkezelése, Escape-es bezárása és mentésnél a bezárás tiltása megmaradt.

Nyitott munkapanelnél a háttérpontok, teendők és gyorsmenü nem zavarják a feladatot. A meglévő kameraátmenetek és a menünyitásra leálló bemutató mód megmaradt. A hiányzó km-adat figyelmeztetése ugyanazt a rögzítőt nyitja, mint a km-gyorsgomb.

Mobilon az öt fő terület kinyitható, egy szintű menüből választható. A **Tankolás** és **Km rögzítése** a jogosult felhasználónál állandó alsó sávban marad. Ugyanaz a két gomb változtat helyet; nincs külön mobilos és asztali példány.

A ritkább részletek kinyithatók; lezárt állapotban a gyermekkomponens nem töltődik be és nem indít lekérdezést.

## Foglalás és előzmények

Kikapcsolt foglalásnál az állapot látszik, üres naptár nem foglal helyet. A jogosult kezelő a meglévő kapcsolóval engedélyezheti. A **Korábbi foglalások hónapja** kinyitása után a hónapváltás kikapcsolt állapotban is működik; a kiválasztott hónap mentett foglalásai megtekinthetők. A legfeljebb hét napos időtartam, ütközésvédelem és lemondási jogok változatlanok.

Az Előzmények egy kiválasztott forrást mutatnak egyszerre. A szerveroldali listák saját lapozása megmaradt; nem készül csak az aktuális lapokat összekeverő közös idővonal. A korábbi rendszám és hozzárendelés, valamint a rögzítő/módosító adatai megmaradnak. Üres listán nincs fölösleges lapozó.

## Jogosultságok és adatok

- A frontend a tényleges `vehicle.permissions` listát használja; a céges összesített jogok nem helyettesítik az autó saját műveleti jogát.
- A tankolás, km-rögzítés, használó- és telephely-hozzárendelés, foglalás, szerviz, lízing, dokumentumkezelés és audit a korábbi külön jogokkal működik.
- Tiltott feladat gyermektartalma és lekérdezése nem indul el. Hibás adatlap-háttérfrissítéskor a korábban lekért adat nem marad látható a profilban vagy garázsfeladatban.
- A szerveroldali jogosultságellenőrzés, cég- és telephelykorlát, CSRF-védelem, verziókezelés, fájlvédelem és naplózás változatlan. Backendkód és adatbázisséma nem változott, migráció nem szükséges.
- Megmaradt a legfeljebb öt kép, dokumentum-előnézet/feltöltés/visszavonás, szerviz- és lízingelőzmény, tankolási bizonylat és CSV-export, valamint archiválás/visszaállítás.

## Kód és ellenőrzés

- [VehiclePage.tsx](../frontend/src/VehiclePage.tsx): teljes adatlap és külön szerkesztés.
- [VehicleTaskContent.tsx](../frontend/src/VehicleTaskContent.tsx): közös, jogosultsággal ellenőrzött feladatok.
- [useVehicleDetails.ts](../frontend/src/useVehicleDetails.ts): közös lekérés és frissítési kulcsok.
- [VehicleHistory.tsx](../frontend/src/VehicleHistory.tsx): rendszám- és km-előzmények.
- [vehicle-profile.css](../frontend/src/vehicle-profile.css): profil- és feladatpanel-elrendezés a meglévő tématokenekkel.
- [vehicleWorkspaceFlows.test.tsx](../frontend/src/vehicleWorkspaceFlows.test.tsx): navigáció, feladatonkénti jog, hibás háttérfrissítés, verziókonfliktus és foglalási állapot regressziós tesztjei.

2026. november 23-án a teljes frontendteszt-csomag **212 tesztje sikeres** volt; a kikapcsolt foglalás korábbi hónapjainak elérésére ezután hozzáadott regressziót tartalmazó célzott futtatás **21 sikeres teszttel** zárult. A meglévő foglalási, km-, elszámolási és dokumentumfolyamatok külön futtatásban további **29 sikeres teszttel** szerepeltek. A lint és production build sikeres; a meglévő nagy Three.js-csomagra a Vite méretfigyelmeztetést ad.

A böngészős ellenőrzés 1440×900, 768×900, 390×844, 320×700 és 867×400 méretben futott, kezelői és korlátozott jogú felhasználóval. A próbák API-fixture-ökkel és valódi GLB-modellekkel ellenőrzik az öt területet, szerkesztési konfliktust, tiltott lekérdezések hiányát, garázsadatpanelt, tankolási űrlapot és vízszintes kilógást. Ezek frontendpróbák; nem helyettesítik az éles adatbázisos vagy valódi mobilkészülékes ellenőrzést. A meglévő üzleti API-tesztek nem változtak.

Közös vizuális szabályok: [DESIGN.md](../DESIGN.md). Környezetek, modellek és teljesítménykorlátok: [Garázs, parkoló és képes nézetek](GARAGE_AND_VISUAL_VIEWS.md).
