# HERMES tesztszerver – Debian 13

Önálló, egy szerverre szánt telepítés Docker Engine és Compose használatával. A helyi fejlesztői `compose.yaml` nem része ennek a konfigurációnak. Az API `Production` környezetben fut. A Caddy kezeli a HTTPS-t, a HTTP→HTTPS átirányítást és a tanúsítványok automatikus megújítását. Csak a proxy 80/443 TCP portja nyilvános; a PostgreSQL és az API nem kap publikált portot.

## Előkészületek

- Debian 13, root/sudo hozzáférés, GitHub-hozzáférés a tárolóhoz.
- A szerverre mutató valódi DNS-név. Az A rekord, és ha van, az AAAA rekord is a megfelelő szerverre mutasson. A 80/443 TCP port legyen elérhető; a csomag nem írja át a meglévő tűzfaladat és nem veszi át más webszerver portjait.
- Kezdésnek 2 CPU és 4 GB RAM javasolt. A szükséges lemez a dokumentumoktól függ; a mentés/visszaállítás munkaterületén a teljes logikai adatbázismentés és a konténerképek többszörösének is el kell férnie. A visszaállítási próba ideiglenesen külön PostgreSQL-t és API-t indít.
- Egy külön mentési hely: például másik szerverre csatolt `/mnt/offsite-backups/hermes`, SFTP- vagy S3-tárhely. Ugyanazon a szerveren egy másik mappa csak helyi másolat, szervervesztés ellen nem véd. A csatolt meghajtó rendelkezésre állását az üzemeltető biztosítsa; ne maradjon észrevétlenül helyi mappán egy kiesett csatolás.
- A kezdeti tesztelők hozzáférését VPN-nel vagy a hálózati belépési ponton korlátozd. Az alkalmazás regisztrációja jelenleg nyitott, e-mail-megerősítés és elfelejtettjelszó-folyamat még nincs.

Docker által publikált portoknál a szolgáltató tűzfalát és a Docker hálózati szabályait is vedd figyelembe; önmagában egy UFW-szabály nem feltétlenül korlátozza a konténerek elérését. [Docker Debian telepítési dokumentáció](https://docs.docker.com/engine/install/debian/).

## Első telepítés

A példákban root shellt használunk. A saját domainnevedet, e-mail-címedet és mentési helyedet add meg. A csomag nem lép be távoli szerverre és nem módosít DNS-t.

```bash
sudo -i
git clone https://github.com/NemodaMark/Hermes_flotter.git /opt/hermes
cd /opt/hermes
bash deploy/debian13/install-debian13.sh
bash deploy/debian13/hermes.sh init flotta-teszt.sajatdomain.hu uzemelteto@sajatdomain.hu /mnt/offsite-backups/hermes
```

Az `init` külön, véletlen 64 karakteres adatbázisjelszavakat és restic-jelszót generál. A konfiguráció `/etc/hermes/staging.env`, a titkosítási jelszó `/etc/hermes/restic-password`, mindkettő csak root számára olvasható. **A restic-jelszót mentsd el külön, például jelszókezelőbe: nélküle a mentés nem állítható vissza.** Ez a jelszó szándékosan nem szerepel a saját mentésében. Ne commitold a valódi konfigurációt vagy a jelszófájlt.

Alternatív repository az `init` harmadik argumentumaként: `sftp:backup@backup.sajatdomain.hu:/srv/backups/hermes`. Az SFTP kulcsát és ellenőrzött szerver-ujjlenyomatát root számára állítsd be; a napi mentés nem kérhet interaktív jelszót. S3 esetén a védett konfigurációba kerülhet `AWS_ACCESS_KEY_ID` és `AWS_SECRET_ACCESS_KEY`. A repositoryt nem hozza létre csendben egy sikertelen mentés.

```bash
bash deploy/debian13/hermes.sh init-repository
bash deploy/debian13/hermes.sh deploy
curl --fail https://flotta-teszt.sajatdomain.hu/health/ready
```

A `deploy` a tiszta, commitolt checkoutot fordítja; a futó API verziója tartalmazza a commitot. A Data Protection-kulcsok `/var/lib/hermes/keys`, az adatbázis `/var/lib/hermes/postgres`, a TLS-állományok `/var/lib/hermes/caddy-*` alatt maradnak meg. A csomag alapból a `172.30.90.0/24` hálózatot és a proxy számára `172.30.90.2` címet használja; ütközés esetén indulás előtt együtt módosítsd a `HERMES_EDGE_SUBNET` és `HERMES_PROXY_IP` értékét. A backend csak ettől az egy proxytól fogadja el a továbbított HTTPS-/klienscím-fejlécet. A fájlhatár 10 MiB, a teljes HTTP-kérésé 12 MiB.

Nyisd meg az oldalt, regisztrálj egy saját, erős jelszavú fiókot, majd add meg a kanonikus felhasználónevét:

```bash
bash deploy/debian13/hermes.sh bootstrap-admin sajat.felhasznalonev
```

Ez csak akkor működik, ha még nincs rendszerszintű kezelő. A további hozzáféréseket a felületen kell kiosztani; az `admin/admin` helyi fejlesztői fiókkal itt nem lehet belépni. Ne töltsd fel a fejlesztői adatbázist a tesztszerverre automatikusan.

## Mentés és automatikus visszaállítási próba

Először kézzel futtasd le a teljes kört, majd engedélyezd az időzítőket:

```bash
bash deploy/debian13/hermes.sh backup
bash deploy/debian13/hermes.sh restore-drill latest
bash deploy/debian13/hermes.sh install-systemd
systemctl list-timers 'hermes-*'
```

- A napi mentés **03:15 UTC** körül indul, legfeljebb 10 perc véletlen késleltetéssel. Az elmaradt futás bekapcsolás után pótlódik.
- A heti teljes repository-ellenőrzés és elkülönített visszaállítás vasárnap **04:30 UTC** körül indul. Ez az összes titkosított adatblokkot olvassa, ezért nagyobb adattömegnél idő- és forgalomigényes.
- Megőrzés: legalább az utolsó 3 mentés, továbbá 7 napi, 4 heti és 3 havi példány. A szabály csak az adott HERMES-példány saját mentéseit érinti.
- A restic titkosított mentése tartalmazza a konzisztens `pg_dump`-ot, a dokumentumok bináris tartalmát, a munkamenetkulcsokat, TLS-állományokat, a védett telepítési konfigurációt, a forráscsomagot és a **ténylegesen futó négy konténerképet**. A nyers, élő PostgreSQL-adatkönyvtárat nem másolja.
- A visszaállítási próba ellenőrzi a repositoryt és az állományok SHA-256 összegét, új adatbázisba tölti a mentést, ellenőrzi a jogosultsági alapfeltételeket és elindítja a mentett API-t. Nem publikál portot, nem futtat új migrációt, nem nyúl a működő adatbázishoz. A próbát utána eltávolítja.
- A konténerek szerverindításkor elindulnak, hibás kilépés után újraindulnak. Az egészségtelen, de még futó folyamat önmagában nem indít Docker-újraindítást; az állapotokat ellenőrizni kell.

```bash
bash deploy/debian13/hermes.sh status
bash deploy/debian13/hermes.sh snapshots
journalctl -u hermes-backup.service -u hermes-restore-drill.service --since yesterday
systemctl --failed
```

A hibás mentés/próba hibás systemd-futásként látszik; automatikus e-mail/riasztási integráció nincs. A `last-backup.json` és `last-restore-drill.txt` a legutóbbi sikeres eredményt jelzi, az időpontjukat is figyelni kell. A műveletek közös zárolást használnak: ütközéskor az új futás hibával leáll, nem indít párhuzamos migrációt vagy mentést. A Docker naplóit szolgáltatásonként 3×10 MB-ra korlátozzuk.

A kicsomagolt munkaterület rövid ideig érzékeny adatokat tartalmaz, jogosultsága 0700. Normál befejezés/hiba esetén törlődik; áramkimaradás vagy SIGKILL után a `/var/cache/hermes/operation.*` maradványait a futó műveletek ellenőrzése után rootként el kell távolítani. Ugyanez érvényes egy megszakított próba `hermes-drill-*` konténereire. A repository és a külön őrzött jelszó ne vesszen el együtt a szerverrel.

## Frissítés

```bash
cd /opt/hermes
git fetch origin
git checkout <ellenorzott-commit-vagy-tag>
bash deploy/debian13/hermes.sh deploy
curl --fail https://flotta-teszt.sajatdomain.hu/health/ready
```

Az új képek elkészülte után a csomag először lementi a korábban futó verziót. Ezután leállítja az API-t, a külön migrációs adatbázis-felhasználóval migrál, majd elindítja az új verziót. Rövid karbantartási kiesés várható. A futó API-nak nincs adatbázisséma-módosító jogosultsága. Nem történik automatikus `git pull` vagy önálló verziófrissítés.

Ha a migráció/indulás hibázik, a `/var/lib/hermes/deploying` jelző megmarad, és a normál indítás/mentés letiltódik. Ne töröld ezt a jelzőt ellenőrzés nélkül, és ne indítsd el egyszerűen a régi API-t az új sémán. A visszafelé migrálás több korábbi sémánál szándékosan tiltott; visszaállításhoz a frissítés előtti teljes mentés kell. Helyreállítás után a régi időzítőket állítsd át az új konfigurációra az új forráscsomag `install-systemd` parancsával.

## Teljes helyreállítás új, üres célra

Az eszköz **nem ír felül meglévő forrás-, adat- vagy konfigurációs célt**. Ugyanazon a szerveren külön Compose-példánynévvel állítja vissza az adatbázist, így az eredeti megmarad. Az API-t és a publikus proxyt csak külön indítás után teszi elérhetővé.

Új szerveren előbb klónozd a projektet, telepítsd az eszközöket, majd futtasd az `init` parancsot ugyanazzal a domainnel és mentési repositoryval. Ez még nem indít adatbázist. Az így létrejött `/etc/hermes/restic-password` fájlt **cseréld le a külön megőrzött eredeti jelszófájlra**, root tulajdonossal és 0600 jogosultsággal; ezen a szerveren ne futtasd az `init-repository` parancsot a meglévő repositoryn. Szükség esetén állítsd be a mentési tárhely hitelesítő adatait, és a `HERMES_INSTANCE` értékét a visszaállítandó mentés eredeti példánynevére. Az eredeti adatbázis-jelszavak a titkosított mentésből kerülnek vissza.

```bash
export HERMES_CONFIG_FILE=/etc/hermes/staging.env
bash /opt/hermes/deploy/debian13/hermes.sh snapshots
bash /opt/hermes/deploy/debian13/hermes.sh recover <snapshot-id> /opt/hermes-recovered /var/lib/hermes-recovered /etc/hermes/recovered.env
```

Ellenőrizd a visszaállított konfigurációt és a helyreállított adatbázist. Ugyanazon a gépen a régi időzítőket állítsd le, a régi példányt bontsd le; a `stop` megtartja az összes adatkönyvtárat, de felszabadítja a portokat és a proxy hálózatát:

```bash
systemctl stop hermes-backup.timer hermes-restore-drill.timer hermes-staging.service
HERMES_CONFIG_FILE=/etc/hermes/staging.env bash /opt/hermes/deploy/debian13/hermes.sh stop
HERMES_CONFIG_FILE=/etc/hermes/recovered.env bash /opt/hermes-recovered/deploy/debian13/hermes.sh start
curl --fail https://flotta-teszt.sajatdomain.hu/health/ready
HERMES_CONFIG_FILE=/etc/hermes/recovered.env bash /opt/hermes-recovered/deploy/debian13/hermes.sh backup
HERMES_CONFIG_FILE=/etc/hermes/recovered.env bash /opt/hermes-recovered/deploy/debian13/hermes.sh install-systemd
```

A helyreállítás nem futtat migrációt és nem fordít újra: a mentett adatbázist a hozzá tartozó bináris verzióval indítja. Az új példánynévnek külön mentési sorozata lesz; a régi mentések a régi konfigurációval továbbra is elérhetők. A visszaállított forráscsomagban nincs `.git`; későbbi fejlesztéshez/frissítéshez klónozd újra a tárolót, és a védett konfiguráció `HERMES_ROOT` értékét az ellenőrzött checkout helyére állítsd át. Az új adatbázist ne keverd össze a korábbi példánnyal.

## Automatizált ellenőrzés

A GitHub `debian-staging` feladata valódi Debian 13 konténerben telepíti az eszközöket, és a Docker-daemonon elkülönített konténerekkel futtatja a teljes próbát. Caddy belső CA-val, tényleges HTTPS-kapcsolaton ellenőrzi a Production belépést, Secure sütiket, közel 10 MiB-os PDF-feltöltést és cégek elkülönítését. Ezután titkosított restic-mentést, elkülönített próbát és teljes helyreállítást végez. Az összes publikus tábla sorainak lenyomatát összehasonlítja; ellenőrzi a PDF pontos bájtjait, a korábbi munkamenet fennmaradását és az új bejelentkezést. Meglévő célra a visszaállítást külön negatív próba tiltja.

A nyilvános ACME-tanúsítvány igénylése és a Debian gép újraindulása csak a saját, DNS-sel és hálózattal rendelkező szerveren próbálható ki. A CI nem kér Let's Encrypt-tanúsítványt és nem használ valódi céges adatokat.

Források: [Caddy automatikus HTTPS](https://caddyserver.com/docs/automatic-https), [ASP.NET megbízható proxyk](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer?view=aspnetcore-10.0), [restic visszaállítás](https://restic.readthedocs.io/en/stable/050_restore.html), [PostgreSQL pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html).
