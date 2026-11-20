# Windows fejlesztői teszttelepítő, mintaadatokkal

Készült: **2026. november 20.** Windows 10/11 x64 rendszerhez, helyi fejlesztéshez és bemutatóhoz.

## Telepítés

1. Bontsd ki a `HERMES-Windows-Dev.zip` csomagot egy mappába.
2. Kattints duplán az **install-dev-windows.cmd** fájlra.
3. Add meg, hová kerüljön a projekt. Enterrel a Dokumentumok mappában a **HERMES-Dev** könyvtárat választod. Új, üres mappát használj.
4. Várd meg a csomagok telepítését, a fordítást és a demóbetöltés ellenőrzését. Első alkalommal internet és a GitHub-tárolóhoz hozzáférés kell. A Git és a .NET telepítéséhez a Windows jogosultságot kérhet.
5. A végén megnyílik a böngésző, a belépési adatokat tartalmazó jegyzettömb és a **HERMES Dev Rendszervezérlő**.

A mintafiókok létrehozásakor az API kéréskorlátja miatt rövid várakozás előfordulhat; ezt a telepítő kiírja, majd automatikusan folytatja.

A `cmd` és a `ps1` fájl maradjon egymás mellett. PowerShellből is indítható, akár előre megadott célmappával:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-workstation.ps1 -Demo -ProjectPath "D:\Fejlesztes\HERMES-Dev"
```

A hiányzó Git és .NET 10 SDK telepítését a [WinGet](https://learn.microsoft.com/windows/package-manager/winget/) végzi; ehhez a Microsoft App Installer szükséges. A telepítő a Node.js/npm és PostgreSQL 18 binárisait is előkészíti, majd telepíti a zárolt npm- és NuGet-függőségeket. A letöltött Node.js- és PostgreSQL-archívumot SHA-256 ellenőrzés védi. Docker nem szükséges.

## Belépés és kipróbálás

A rendszergazda neve **admin**. A rendszergazda és a demófiókok egyedi, véletlenül generált jelszavai itt találhatók:

```text
<projektmappa>\.local\demo-data\BELEPESI_ADATOK.txt
```

Ugyanitt az `admin.json` és a `bejelentkezesek.json` géppel olvasható formában is megmarad. A könyvtár hozzáférését a telepítő az aktuális Windows-felhasználóra és a SYSTEM-fiókra korlátozza. A jelszavakat ne küldd tovább; ezek a fájlok Git által figyelmen kívül hagyott helyi adatok.

Belépés után válaszd a **Demo Flotta** céget. Kipróbálható fiókok:

| Felhasználónév | Mire használható? |
| --- | --- |
| `admin` | Rendszerkezelés, felhasználók és jogosultságok beállítása |
| `demo.nagy.anna` | Flottakezelés, áttekintő dashboard, teljes demócéges jármű-hozzáférés |
| `demo.kovacs.bence` | Diszpécser, autós dashboard, foglalás |
| `demo.kiss.ferenc` | Budapesti telephely járművei és kilométer-rögzítés |
| `demo.molnar.gabor` | Debreceni telephely járművei és kilométer-rögzítés |
| `demo.varga.eszter` | Győri telephely járművei és kilométer-rögzítés |
| `demo.balogh.julia` | Bejelentkezhető fiók, szándékosan felfüggesztett cégtagsággal |

A tíz demófiókhoz nincs rendszerszintű kezelői jog kiosztva. A telephelyre korlátozott felhasználók más telephelyek autóit és a telephely nélküli autókat nem láthatják.

## Milyen mintaadatok kerülnek be?

- 1 Demo Flotta cég, 3 telephely: Budapest, Debrecen, Győr.
- 10 demófelhasználó, 8 céges jogosultságcsoport, különböző hozzáférésekkel.
- 30 jármű, különböző állapotokkal, karosszériával, színnel, kilométerekkel és határidőkkel.
- 5 partner, 18 lízing-/bérleti szerződés, 60 szervizbejegyzés, kilométer- és használati előzmények.
- 4 foglalható jármű: **DEMO-002, DEMO-003, DEMO-004, DEMO-006**; összesen 8 névvel és dátummal megjelenő mintafoglalás. Az időszakok az első betöltés napjához igazodnak; egy foglalás legfeljebb 7 nap.

A foglalások a jármű adatlapjának foglalási naptárában láthatók. Nagy Anna és Kovács Bence fiókjával is kipróbálhatók. A szerződés- és szervizrekordok mintaadatok; a telepítő nem csatol hozzájuk mesterséges PDF-eket vagy fényképeket. A Microsoft Entra-belépéshez továbbra is saját céges konfiguráció szükséges.

## Indítás, állapotellenőrzés, naplók

A telepítő elhelyezi az asztalon a **HERMES Dev Rendszervezérlő** parancsikont. Következő gépindításkor ezzel, majd a **Teljes rendszer újraindítása** gombbal indítható az adatbázis, az API és a frontend. A vezérlő megmutatja a health állapotokat, a saját folyamatokat, a Git-verziót és a naplókat. [A vezérlő részletes útmutatója](https://github.com/NemodaMark/Hermes_flotter/blob/main/desktop/README.md).

A szolgáltatások a helyi gépen, `127.0.0.1` címen érhetők el. Az alapértelmezett portok: adatbázis **55432**, API **5080**, frontend **5173**. Foglalt port esetén a telepítő másikat választ; a tényleges böngészőcím a belépési adatfájlban és a vezérlőben található.

| Hely | Tartalom |
| --- | --- |
| `.local/workstation/postgres` | Ennek a fejlesztői példánynak a saját PostgreSQL-adatbázisa |
| `.env` | Helyi, generált adatbázis-jelszavak |
| `.local/control-center/settings.json` | Programútvonalak és portok |
| `.local/control-center/logs` | Adatbázis-, backend- és frontendnaplók |
| `.local/demo-data` | Betöltési állapot és tesztbelépések |

Parancssori állapotellenőrzés a projekt gyökeréből, a telepítéskor kiválasztott .NET-tel:

```powershell
dotnet .local/workstation/launcher/Hermes.Workstation.dll status "$PWD"
```

## Megszakítás, újrafuttatás és frissítés

Ha a telepítés megszakad, ugyanazzal a paranccsal és ugyanazzal a célmappával folytasd. Az elkészült példány újrafuttatásakor a telepítő megőrzi a jelszavakat és a meglévő betöltési állapotot, elindítja a szolgáltatásokat és ellenőriz. A már felvitt demófiókokból, autókból és foglalásokból nem készít újabb másolatot. Ha a demóadatokat közben kézzel módosítottad, a szigorú adatmennyiség-ellenőrzés eltérést jelezhet; új bemutatóhoz válassz új mappát. A foglalási dátumokat újrafuttatáskor megőrzi.

A demótelepítő a saját jelölőfájlja nélküli, már meglévő projektmappát elutasítja. A normál fejlesztői adatbázist így nem tölti fel vagy írja át véletlenül. A fejlesztéshez a klónozott forrás szabadon módosítható; az alkalmazás frissítését a saját Git-munkarended szerint végezd, a futó szolgáltatások megfelelő leállítása/újraindítása mellett. A telepítő folytató módja nem frissíti automatikusan a forrást.

A `-NoLaunch` kapcsolóval a telepítés és az összes ellenőrzés lefut, a végén nem nyílnak meg a felhasználói ablakok. A `-SkipShortcut` kihagyja az asztali ikon létrehozását. Hibánál a telepítő hibakóddal leáll; a saját adatkönyvtárat megőrzi.

## Csomag készítése és teszt

A projektből újra elkészíthető a továbbadható, jelszómentes ZIP és a hozzá tartozó SHA-256 fájl:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-dev-installer.ps1
```

Eredmény: `.local/installers/HERMES-Windows-Dev.zip`. A csomag a telepítőt és ezt az útmutatót tartalmazza; a projekt a GitHub `main` ágáról érkezik. [Forráskód](https://github.com/NemodaMark/Hermes_flotter).

A Windows integrációs próba a `scripts/tests/workstation-windows-demo.ps1`: külön mappába telepít, ellenőrzi a belépéseket, a jogosultsági korlátokat, a mintafoglalásokat, a health végpontokat és az ismételt futást. A próba nem helyettesíti egy teljesen üres Windows virtuális gépen a WinGet-rendszercsomagok telepítésének ellenőrzését.

**Ellenőrzés, 2026. november 20.:** külön Windows-projektmappába történő telepítés és demóbetöltés sikeres; a szóközös/ékezetes útvonal, a meglévő példány melletti eltérő portok, a rendszergazda-létrehozás megszakítás utáni folytatása, a változatlan tesztjelszavakkal történő ismételt futás, az asztali parancsikon és a négy health ellenőrzés kipróbálva. Az API kéréskorlátja miatti automatikus várakozás is működött. A rendszervezérlő 16 automatizált tesztje sikeres. A gépen a rendszerfüggőségek már rendelkezésre álltak; teljesen üres Windows virtuális gépen a WinGet-telepítés még nincs igazolva.
