# HERMES – munkaállomás telepítése

A két szkript Git, .NET 10 SDK, Node.js/npm és PostgreSQL 18 környezetet készít elő. Ezután megkérdezi, melyik mappába kerüljön a projekt. Letölti a `main` ágat, telepíti a projekt NuGet- és zárolt npm-függőségeit, előkészíti a helyi PostgreSQL-t, lefuttatja a migrációkat, és asztali indítót helyez el.

## Windows x64

Töltsd le az [install-workstation.ps1](https://github.com/NemodaMark/Hermes_flotter/raw/refs/heads/main/scripts/install-workstation.ps1) fájlt. A letöltési mappából futtasd PowerShellben.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-workstation.ps1
```

Enterrel a Dokumentumok mappában lévő `HERMES` könyvtárat választod. Megadhatod a saját útvonalat is a `-ProjectPath` kapcsolóval. A hiányzó Git és .NET SDK telepítéséhez a Windows App Installer (WinGet) és esetenként a Windows jóváhagyása szükséges. [WinGet](https://learn.microsoft.com/windows/package-manager/winget/) · [.NET telepítése Windowsra](https://learn.microsoft.com/dotnet/core/install/windows) · [PostgreSQL Windows-csomag](https://www.postgresql.org/download/windows/)

Nyisd meg az asztali **HERMES Rendszervezérlő** parancsikont, majd kattints a **Teljes rendszer újraindítása** gombra. A Windows-indító az eddigi .NET/WPF alkalmazás a szolgáltatások, a naplók és a Git-verziók állapotával. [A Windows-vezérlő használata](../desktop/README.md)

## Debian 13 és Ubuntu 24.04 x86-64

Töltsd le az [install-workstation.sh](https://github.com/NemodaMark/Hermes_flotter/raw/refs/heads/main/scripts/install-workstation.sh) fájlt, és futtasd asztali felhasználóként. Szükség esetén a szkript maga kér `sudo`-jogot a rendszerfüggőségekhez.

```bash
bash ./install-workstation.sh
```

Az alapértelmezett projektmappa `~/HERMES`. Útvonalat első argumentumként is megadhatsz. A PostgreSQL APT-csomag telepítésekor a disztribúció létrehozhat egy külön rendszerklasztert. A HERMES a saját projektmappájában lévő klasztert használja. [.NET Debianon](https://learn.microsoft.com/dotnet/core/install/linux-debian) · [.NET Ubuntun](https://learn.microsoft.com/dotnet/core/install/linux-ubuntu-install) · [PostgreSQL APT](https://www.postgresql.org/download/linux/ubuntu/)

A **HERMES Rendszervezérlő** ikon terminálablakban indítja a projektet, megjeleníti a webes címet, a naplók mappáját és az állapotellenőrzés eredményét. Az `S` billentyűvel leállítható a három helyi szolgáltatás. Asztali környezettől függően első alkalommal az ikon helyi menüjében engedélyezni kell az indítást. Terminálból, a projekt gyökerében is futtatható.

```bash
dotnet .local/workstation/launcher/Hermes.Workstation.dll start "$PWD"
dotnet .local/workstation/launcher/Hermes.Workstation.dll status "$PWD"
dotnet .local/workstation/launcher/Hermes.Workstation.dll stop "$PWD"
```

## Első belépés és újrafuttatás

- Az interaktív telepítő kérésre létrehozza az első rendszergazdát a megadott felhasználónévvel, e-mail-címmel és rejtve bekért jelszóval. Ha kihagytad, a projekt gyökerében a `dotnet .local/workstation/launcher/Hermes.Workstation.dll admin . FELHASZNALONEV EMAIL` paranccsal hozhatod létre. Ehhez a telepítéskor kiválasztott .NET 10 SDK szükséges.
- Az adatbázis az adott projektben a `.local/workstation/postgres` mappában marad. A `.env` helyi, véletlenszerű jelszavakat tartalmaz, a vezérlő beállításai és a szolgáltatásnaplók a `.local/control-center` mappába kerülnek. A három szolgáltatás a loopback interfészen indul. A preferált portok 55432, 5080 és 5173, foglalt portnál a telepítő szabad portot választ.
- Meglévő munkapéldánynál válassz tiszta, `main` ágon lévő HERMES checkoutot. A szkript `git pull --ff-only` paranccsal frissít, és megőrzi a saját adatbázist. Ha a munkapéldányhoz már más adatbázis vagy kézi konfiguráció tartozik, válassz külön mappát. Fordítás előtt állítsd le az adott checkoutban futó fejlesztői szolgáltatásokat.
- A GitHub-hozzáféréshez a gépen konfigurált Git-hitelesítést használd. A szerverre telepítéshez a [Debian és TeamCity útmutató](../deploy/teamcity/README.md) tartozik.
