# HERMES telepítése Debian 13-ra és frissítése TeamCityből

**Dokumentálva:** 2026. november 13. (Europe/Budapest)

## Első telepítés

A szerveren legyen a gépre mutató DNS-név, elérhető HTTPS-port és külön mentési tárhely. A TeamCity Linux agent érje el SSH-n a Debian szervert. A root tulajdonú telepítési könyvtárból a szervernek el kell érnie a GitHub-tárolót és a konténerregisztereket. Privát tárolónál az agent és a Debian host külön olvasási hozzáférést használjon. [Docker Engine Debianon](https://docs.docker.com/engine/install/debian/) · [GitHub deploy key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys).

1. Hozz létre egy külön Ed25519 kulcspárt a TeamCityhez. A privát kulcsot a TeamCity projekt **SSH Keys** részébe töltsd fel `hermes-deploy` néven. A Debian gépre csak a saját publikus kulcsa kerüljön.
2. Klónozd rootként a tárolót a szerverre, és ellenőrizd az elsőként telepítendő main commitot. A példában a domain, a kapcsolattartói e-mail és a mentési útvonal helyőrző.
3. Futtasd egyszer az alábbi parancsokat.

```bash
sudo -i
apt-get update && apt-get install -y git ca-certificates
git clone https://github.com/NemodaMark/Hermes_flotter.git /opt/hermes
cd /opt/hermes
git log -1 --oneline
bash deploy/debian13/install-hermes.sh flotta.example.hu uzemelteto@example.hu \
    /mnt/offsite-backups/hermes /root/hermes-teamcity.pub
```

A telepítő beállítja a Docker Engine-t, a Compose-t, a Caddyt és a PostgreSQL szerepköreit. Létrehozza az elkülönített jelszavakat, telepíti és ellenőrzi az első kiadást, elkészíti a titkosított mentést, és visszaállítási próbát futtat. Siker után engedélyezi a napi mentést és a heti próbát, majd felveszi a TeamCity telepítőkulcsát. A konfiguráció `/etc/hermes/staging.env`, a mentési jelszó `/etc/hermes/restic-password`. A jelszó külön megőrzendő. Megszakadt első telepítésnél az elkészült lépés után a megfelelő [üzemeltetési paranccsal](../debian13/README.md) folytatható az inicializálás. A szkript meglévő példány mellett hibával tér vissza.

Az első rendszerszintű kezelő a saját regisztrációját követően a `hermes.sh bootstrap-admin KANONIKUS_FELHASZNALONEV` paranccsal állítható be. Már futó, korábban kézzel telepített példány TeamCityhez kapcsolásakor az ellenőrzött checkout `install-teamcity-access.sh` parancsa telepíti az SSH-hozzáférést a teljes telepítés megismétlése nélkül. A kiadási belépési pont az alapértelmezett staging konfigurációt használja.

## TeamCity projekt beállítása

1. Hozz létre projektet a HERMES tárolóból. Kapcsold be a Kotlin **Versioned Settings** importot a `.teamcity/settings.kts` fájlhoz. A konfiguráció a 2025.11 DSL-verziót célozza. Az adott szerver DSL-kompatibilitását az importnapló mutatja. [Kotlin DSL](https://www.jetbrains.com/help/teamcity/kotlin-dsl.html) · [Versioned Settings](https://www.jetbrains.com/help/teamcity/storing-project-settings-in-version-control.html).
2. Regisztrálj Linux build agentet Bash, Git (agent checkout), Node.js 22.20 vagy újabb 22-es, npm, .NET 10 SDK, Docker, OpenSSH és ShellCheck eszközökkel. A PostgreSQL integrációs tesztek Testcontainers segítségével külön próba-adatbázisokat hoznak létre. [Testcontainers PostgreSQL](https://dotnet.testcontainers.org/modules/postgres/).
3. Add meg az `env.HERMES_DEPLOY_HOST` értékét. Az agent ellenőrzött `known_hosts` fájljának útvonalát az `env.TEAMCITY_SSH_KNOWN_HOSTS` paraméterrel add át. A szerverkulcs ujjlenyomatát a Debian konzolon ellenőrizd. A DSL automatikusan betölti a `hermes-deploy` kulcsot az SSH Agent funkcióval. [SSH Agent](https://www.jetbrains.com/help/teamcity/ssh-agent.html).
4. Futtasd kézzel az első buildet. A `verify.sh` frontend-fordítást, lintet, frontend-, backend- és Control Center-teszteket, valamint ShellChecket futtat. Siker esetén a `release.sh` az ellenőrzött teljes SHA-t adja át a szervernek. A VCS-trigger a fő ág új revízióin fut. [VCS triggers](https://www.jetbrains.com/help/teamcity/configuring-vcs-triggers.html).

A fiók nem Docker-csoporttag. Az SSH-kulcshoz rendelt kényszerített parancs kizárólag `deploy <40 hex karakter>` alakot fogad el, és egy root tulajdonú, szűk belépési pontot hív. A szerver ellenőrzi az origin tárolót, a tiszta checkoutot, az ellenőrzött main revíziót és az előrehaladó commitláncot. Későn sorra kerülő régi build helyett az aktuális main build kerülhet ki. A szerver a közös műveleti zárolás alatt készíti el a képeket és a kiadás előtti mentést, majd külön migrációs fiókkal frissíti a sémát. Az utolsó lépés a HTTPS readiness és a ténylegesen válaszoló API-commit ellenőrzése. Azonos revízió elküldése újratelepítés nélkül futtatja a két ellenőrzést.

A GitHub Actions ugyanúgy ellenőrizheti a kódot és a Debian helyreállítási folyamatot. A kinti frissítést a TeamCity végzi. A szervernek a `main` ágat és az azon tárolt telepítőkódot futtatható, megbízható kiadásként kell kezelnie. [GitHub tároló](https://github.com/NemodaMark/Hermes_flotter) · [Actions](https://github.com/NemodaMark/Hermes_flotter/actions).

## E-mail-küldés és flottaemlékeztetők

A védett staging konfigurációban állítsd be a saját szolgáltatói adatokat. A jelszót a shell és a Compose által egyaránt helyesen olvasható formában add meg. A példa helyőrzőket tartalmaz.

```dotenv
FLEET_REMINDERS_ENABLED=true
HERMES_EMAIL_MODE=Smtp
HERMES_EMAIL_FROM=flotta@example.hu
HERMES_SMTP_HOST=smtp.example.hu
HERMES_SMTP_PORT=587
HERMES_SMTP_SECURITY=StartTls
HERMES_SMTP_USERNAME=flotta@example.hu
HERMES_SMTP_PASSWORD='JELSZO_HELYE'
```

A beállítás a következő TeamCity-kiadásban lép életbe. Az alkalmazás a beállított publikus HTTPS-domainből képezi a levél linkjét. Az emlékeztető igazolt e-mail-című, aktív, a járműre jogosult felhasználókhoz jut el. A restore drill elkülönített Compose-konfigurációja kikapcsolva hagyja az SMTP-t és az emlékeztetőket. [MailKit](https://github.com/jstedfast/MailKit) · [HERMES fiókfolyamatok](../../backend/README.md).

## Kiinduló ellenőrzések

| Ellenőrzés | Elvárt eredmény |
|---|---|
| Kezdeti telepítés | HTTPS 200 a `/health/ready` végponton, mentés és izolált restore drill sikeres. |
| Első TeamCity build | A tesztek sikeresek és `/health/version` az indított build SHA-ját mutatja. |
| Inkompatibilis build | A hibás teszt megállítja a kiadást a szerver érintése előtt. |
| Migrációs hiba | A build hibás. A `deploying` jelző megmarad és a kiadás előtti restic snapshot használható. |
| Újraindítás | A telepített szolgáltatás és a mentési időzítők futnak. Az adatbázis a megőrzött köteten marad. |

A TeamCity szerver és az éles Debian host első futtatása a saját környezetben ellenőrizhető. A részletes [mentési megőrzés és helyreállítás](../debian13/README.md#teljes-helyreállítás-új-üres-célra) leírja az adatbázis, a hozzá tartozó konténerképek és a TLS-fájlok visszaállítását.
