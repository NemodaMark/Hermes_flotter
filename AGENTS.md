# Projektutasítások

## Fejlesztési prioritás

A felhasználó kérése alapján a backend működése az elsődleges. A következő fejlesztéseknél az üzleti szabályokra, az API-ra, az adatbázisra, a többcéges jogosultságokra és ezek tesztelésére összpontosíts. A frontend egyelőre a működés kipróbálását szolgálja; a látvány finomítása külön kérésre kerüljön előtérbe.

A hozzáférés műveleti jogokon alapul, cégenként és felhasználónként közvetlenül vagy szerkeszthető jogosultságcsoportokkal kiosztva. A csoportok jogcsomagok, nem fix felhasználói szintek. A kért védett `admin` csoport minden jelenlegi és jövőbeli céges jogot megkap; ez nem ad rendszerszintű `system.manage` jogot. Új céges művelethez add meg a szükséges jogot, a szerveroldali ellenőrzést és a cégek elkülönítését igazoló tesztet. A csoportokat minden jogosultság-ellenőrzésnél, visszaállításnál és delegálásnál vedd figyelembe; a változásokat naplózd.

A felhasználó kérése alapján a felhasználó belső elsődleges kulcsa maga az egyedi, kanonikus felhasználónév (`Id = UserName`), a teljes névtől és e-mailtől függetlenül. Ne vezess vissza külön UUID-alapú felhasználói kulcsot. A régi azonosítók csak a naplózási előzmények és névfoglalás miatt maradnak meg.

## Git-munkarend

A felhasználó állandó kérése: minden befejezett, fájlmódosítással járó feladat végén commitold és pushold a változtatásokat a GitHubra, külön megerősítés nélkül.

- A feladathoz tartozó új és módosított projektfájlokat vedd fel a commitba.
- Használj beszédes commitüzenetet.
- Az aktuális ágat pushold az `origin` távoli tárolóba (`https://github.com/NemodaMark/Hermes_flotter.git`). Ha az ágnak még nincs upstream beállítása, a push során állítsd be.
- Ha nincs fájlváltozás, ne hozz létre üres commitot.
- A záró válaszban röviden jelezd a commitot és a push eredményét. Ha a feltöltés nem sikerül, ezt egyértelműen jelezd.
