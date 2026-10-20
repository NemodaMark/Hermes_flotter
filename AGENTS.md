# Projektutasítások

## Fejlesztési prioritás

A felhasználó kérése alapján a backend működése az elsődleges. A következő fejlesztéseknél az üzleti szabályokra, az API-ra, az adatbázisra, a többcéges jogosultságokra és ezek tesztelésére összpontosíts. A frontend egyelőre a működés kipróbálását szolgálja; a látvány finomítása külön kérésre kerüljön előtérbe.

A hozzáférés műveleti jogokon alapul, cégenként és felhasználónként közvetlenül vagy szerkeszthető jogosultságcsoportokkal kiosztva. A csoportok jogcsomagok, nem fix felhasználói szintek. A kért védett `admin` csoport minden jelenlegi és jövőbeli céges jogot megkap; ez nem ad rendszerszintű `system.manage` jogot. Új céges művelethez add meg a szükséges jogot, a szerveroldali ellenőrzést és a cégek elkülönítését igazoló tesztet. A csoportokat minden jogosultság-ellenőrzésnél, visszaállításnál és delegálásnál vedd figyelembe; a változásokat naplózd.

Egyetlen közös csoportmodell és csoportkezelés van; minden egyéni csoporthoz egy vagy több cég és jogcsomag választható. Az admin pontosan egy közös, védett definíció; az adminjog cégkijelölése felhasználónként történik. Új céghez ne készíts új admincsoportot, és az adminok, illetve cégek összesítéséből soha ne készíts jogosultsági keresztszorzatot. Más cégekben meglévő admin-hozzárendelést a részlegesen jogosult kezelő szerkesztése őrizzen meg. Ne vezess vissza külön céges és többcéges csoporttípust. A csoportokat cégkezelők is kezelhetik, de minden érintett cégnél külön ellenőrizni kell az aktuális kezelési és delegálási jogukat. Más, általuk nem kezelt cégek csoportjai nem listázhatók és nem módosíthatók. Hozzárendeléskor a kiválasztott cégekhez csoportból származó hozzáférés készül; visszavonáskor csak ez szűnik meg. Az önálló tagságokat és jogokat őrizd meg, felfüggesztett tagságot csoportművelet nem aktiválhat újra. A csak részben jogosult kezelő módosítása a nem kezelt csoporttagságokat tartsa meg. A több cégre kiterjedő változásokat atomikusan, az utolsó jogkezelő védelmével és naplózással kell menteni.

A csoportoknál cégenként teljes céges vagy kijelölt telephelyekre korlátozott hozzáférés állítható be. A jármű- és telephelyműveleteket, valamint ezek naplóját jogonként a saját forráscsoportjának telephelyeire korlátozd: külön csoportok jogai és telephelyei között ne készíts keresztszorzatot. A közvetlen jogok és más csoportok jogai összeadódnak; a védett közös admin a felhasználónként kijelölt cégekben teljes hozzáférést ad. Telephely nélküli járműhöz csak az adott műveletre teljes céges joggal lehet hozzáférni. Korlátozott felvételi joggal a jármű és engedélyezett telephely-hozzárendelése atomikusan jön létre; áthelyezéskor a forrás és a cél jogát is ellenőrizd. A telephelykorlátot minden járműlistában, közvetlen elérésnél, módosításnál, naplóban, delegálásnál, meghívás-elfogadásnál és hozzáférés-visszaállításnál vedd figyelembe. Telephelyre korlátozott automatikus teljes jogkör nem ad teljes céges admin-delegálási jogot. A többi céges műveleti jog továbbra is cégszintű.

A felhasználó kérése alapján a felhasználó belső elsődleges kulcsa maga az egyedi, kanonikus felhasználónév (`Id = UserName`), a teljes névtől és e-mailtől függetlenül. Ne vezess vissza külön UUID-alapú felhasználói kulcsot. A régi azonosítók csak a naplózási előzmények és névfoglalás miatt maradnak meg.

## Járművek és partnerek

A jármű belső UUID-azonosítója változatlan marad; a felületen a rendszám az elsődleges azonosító. Rendszám- vagy országváltáskor hozzáfűzött, adatbázisszinten nem átírható rendszámelőzmény készüljön. A korábbi rendszám alapján is kereshető maradjon az autó. A partneradatok cégszintűek; a lízing- és szervizadatok a jármű saját, jogonként ellenőrzött telephelykorlátját követik. A jármű olvasási vagy szerkesztési joga önmagában nem ad lízing-, szerviz- vagy partnerkezelési jogot. A partnerkiválasztás ezek saját műveleti jogával minimális név/ID listát adhat vissza, kapcsolattartási adatok nélkül.

A lízingszerződések és szervizbejegyzések külön, verziózott előzmények. Aktív lízing csak lízingelt vagy bérelt járműhöz tartozhat, a jármű aktív szerződéseinek időszakai nem fedhetik egymást. Aktív szerződésben használt lízingbeadó, illetve alapértelmezett szervizként használt partner nem archiválható és érintett kategóriája nem vonható vissza. A történeti hivatkozásokat archiválás után is őrizd meg. Szerviz érvényteleníthető indoklással, törléssel nem tüntethető el. A szerviznél feljegyzett történeti kilométer és következő határidő nem írja át automatikusan a jármű aktuális kilométerállását vagy határidejét. Archivált jármű csak indokolt visszaállítás után módosítható, beleértve a régebbi API-végpontokat és az áthelyezést is.

## Git-munkarend

A felhasználó állandó kérése: minden befejezett, fájlmódosítással járó feladat végén commitold és pushold a változtatásokat a GitHubra, külön megerősítés nélkül.

- A feladathoz tartozó új és módosított projektfájlokat vedd fel a commitba.
- Használj beszédes commitüzenetet.
- Az aktuális ágat pushold az `origin` távoli tárolóba (`https://github.com/NemodaMark/Hermes_flotter.git`). Ha az ágnak még nincs upstream beállítása, a push során állítsd be.
- Ha nincs fájlváltozás, ne hozz létre üres commitot.
- A záró válaszban röviden jelezd a commitot és a push eredményét. Ha a feltöltés nem sikerül, ezt egyértelműen jelezd.
