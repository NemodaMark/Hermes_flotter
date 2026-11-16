# CSV-csomag importálása a HERMES-be

Az importáló a [HERMES adatbázis-leírásban](HERMES_ADATBAZIS_LEIRAS.md) megadott CSV-neveket és mezőket használja. Betölti a cégeket, telephelyeket, profilokat, hozzáféréseket, partnereket, járműveket és előzményeket. A `files.csv` alapján a fájlok a kapcsolódó HERMES-rekordokhoz kerülnek.

## A csomag

- Adj át egy ZIP-et vagy a csomag mappáját. A `companies.csv` kötelező. A többi CSV akkor szükséges, ha az adott adattípusból van exportált rekord. A ZIP-ben a CSV-k lehetnek a gyökérben vagy egy közös felső mappában.
- A CSV-k legyenek UTF-8 kódolásúak és vesszővel tagoltak. A hiányzó mező legyen üres, a logikai érték `true` vagy `false`, a pontos időpont tartalmazzon időzónaeltolást vagy `Z` jelölést. Egy CSV legfeljebb 64 MiB lehet.
- A csatolmányok a `files/` mappába kerüljenek. A `files.csv` például `files/auto-42/forgalmi.pdf` útvonallal hivatkozzon rájuk. Az import ellenőrzi az eredeti fájl méretét, SHA-256 lenyomatát és típusát. A járműokmányokat eredeti bájtjaikkal tárolja, a fotókat a meglévő feltöltéshez hasonlóan újrakódolja.
- A meghívóelőzmények opcionálisan `invitations.csv` fájlban adhatók át. A mezők `company_ref`, `invitation_ref`, `email`, `created_at`, `expires_at`, `accepted_at`, `revoked_at`, `invited_by_ref` és `permission_codes`. A jogosultságokat az utóbbi mezőben függőleges vonal választja el. A régi meghívók előzménye bekerül a céges naplóba.

## Futtatás

Ugyanazt a csomagot futtasd először `--apply` nélkül. A próba lefuttatja a mező-, fájl- és adatbázis-ellenőrzéseket, majd visszagörgeti a tranzakciót. A `validated` eredménynél futtasd újra `--apply` kapcsolóval. Sikeres betöltés után a jelentés állapota `imported`. Azonos csomag újrafuttatásakor az `already_imported` eredmény jelzi, hogy a rekordok már létrejöttek.

### Helyi telepítés

A [munkaállomás-telepítővel](MUNKAALLOMAS_TELEPITES.md) előkészített projekt gyökerében.

```text
dotnet .local/workstation/launcher/Hermes.Workstation.dll import-csv . "C:\Adatátadás\flotta.zip" --owner admin
dotnet .local/workstation/launcher/Hermes.Workstation.dll import-csv . "C:\Adatátadás\flotta.zip" --owner admin --apply
```

Linuxon a csomag útvonalához például `/home/uzemelteto/flotta.zip` adható meg. A parancshoz a jelenlegi munkaállomás-indító és API-fordítás szükséges. Kézzel telepített példánynál a migrációs kapcsolatot biztosító `ConnectionStrings__Migrations` környezetben a `dotnet Hermes.Api.dll --import-csv ...` parancs használható.

### Helyi Docker Compose

Futó, már migrált adatbázissal a projekt gyökeréből. A második futtatáshoz add a parancs végéhez az `--apply` kapcsolót.

```bash
docker compose build migrate
docker compose run --rm --no-deps -T --user 0 \
  --volume "/teljes/utvonal/flotta.zip:/hermes-import.zip:ro" \
  migrate --import-csv /hermes-import.zip --owner admin
```

### Debian-kiszolgáló

A telepített kiadás könyvtárában, az üzemeltetői fiókból. Az importálót tartalmazó kiadás legyen telepítve, az adatbázis pedig fusson.

```bash
sudo bash deploy/debian13/hermes.sh import-csv /var/lib/hermes/import/flotta.zip --owner admin
sudo bash deploy/debian13/hermes.sh import-csv /var/lib/hermes/import/flotta.zip --owner admin --apply
```

A `--owner admin` helyére olyan meglévő fiók neve kerülhet, amelynek van `system.manage` joga. Ez a kapcsoló az új cégekhez céges admin-hozzáférést ad a megadott személynek. A CSV-ben szereplő `admin_companies.csv` személyenként és cégenként rögzíti a többi admin-hozzáférést.

## Fiókok és az eredmény ellenőrzése

- Az import **új cégeket** hoz létre. Ha azonos nevű cég van a célrendszerben, a betöltés megáll. Egy azonos felhasználónévvel és e-mail-címmel már létező fiók felhasználható a kapcsolatokhoz, a profilja és korábbi hozzáférései megmaradnak.
- Az új helyi fiókok a HERMES **Elfelejtett jelszó** folyamatán állíthatják be saját jelszavukat. Ehhez működő levélküldés szükséges. Az `entra_object_id` mezőhöz a HERMES Entra-beállításában engedélyezett címtár kell. Régi jelszó és token helyett a célrendszer kezeli a belépést.
- Az ellenőrzés megadja a fájlt és a sort, ha valamelyik adat hibás. Javítás után ugyanaz a próba megismételhető. A meglévő adatbázis megtartásához a teljes betöltés előtt készíts mentést.
- A jelentés fájlonkénti sorösszesítést és cégazonosítókat ad. A próbaimport cégazonosítói ideiglenesek. Az import forráslenyomata és az átvett történeti események bekerülnek a megfelelő rendszer- vagy céges naplóba.
