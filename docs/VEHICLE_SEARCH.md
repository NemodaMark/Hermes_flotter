# Járműkeresés, szűrés és lapozás

## Felhasználói működés

A Járművek oldal a szervertől kapja a keresett és szűrt oldal tartalmát. Alapértelmezésben legfeljebb 25 járművet tölt be; a felületen 25, 50 vagy 100 sor választható. A keresés 250 ms gépelési szünet után indul, külön Keresés gomb nélkül.

- Kereshető az aktuális és a korábbi rendszám, a gyártó és a modell. A jelenlegi azonosítási mezők összevonva is kereshetők, például `Ford Focus`.
- A keresés kis- és nagybetűtől független, az ékezetes betűknél is. Nem ékezet nélküli vagy elgépelést javító kereső: `Skoda` nem helyettesíti a `Škoda` alakot. A `%`, `_` és `\` karakterek közönséges szövegként működnek.
- Az állapotszűrő és a közös munkaterület-választó telephelye együtt érvényesül. Az alapértelmezett **Minden állapot** az archivált, még olvasható járműveket is tartalmazza.
- Keresés, állapot-, telephely-, cég- vagy oldalméretváltás után az első oldal jelenik meg. Ha időközben csökken a találatok száma, a szerver az utolsó létező oldalt adja vissza.
- A láblécben a szűrt találatszám szerepel, nem az aktuális oldal sorainak száma. A `3 / 80 jármű` három találatot jelent a felhasználó összes, számára olvasható 80 járművéből. Mindkét szám jogosultság szerint szűrt.
- A lejárt lekéréseket a kliens megszakítja. A gyorsítótár kulcsa a felhasználót, céget, szűrőket, lapozást és aktuális jogosultsági köröket is tartalmazza; eltérő cégek és hozzáférések adatai nem közös listából származnak.

## API

`GET /api/v1/vehicles/search`

Bejelentkezés, `X-Tenant-Id` fejléc és az adott cégben `vehicles.read` jog szükséges. GET kérésként nem módosít adatot.

| Paraméter | Alapérték | Jelentés |
|---|---|---|
| `page` | `1` | Legalább 1; a válaszban szerepel a ténylegesen visszaadott oldalszám |
| `pageSize` | `25` | Egész szám 1–100 között |
| `search` | üres | Szóközöktől megtisztítva legfeljebb 200 karakter |
| `status` | `all` | `all`, `Active`, `Maintenance`, `Inactive`, `Archived` |
| `siteId` | `all` | `all`, `none` vagy egy telephely UUID-ja |

Példa:

```http
GET /api/v1/vehicles/search?page=2&pageSize=25&search=Ford&status=Maintenance&siteId=all
X-Tenant-Id: <engedélyezett-cég-azonosítója>
```

```json
{
  "items": [],
  "total": 0,
  "availableTotal": 80,
  "page": 1,
  "pageSize": 25
}
```

Ez a példaválasz üres találatot mutat: a cégben 80 jármű olvasható, a megadott szűrőkre nincs találat. Üres listánál a tényleges oldal mindig 1. Hibás paraméter esetén `400`, hiányzó hitelesítésnél `401`, hiányzó céges olvasási jognál `403` a válasz. Egy másik céghez tartozó vagy nem olvasható telephely UUID-ja nem ad hozzáférést és nem árulja el a telephely létezését: a saját olvasási körrel vett metszet üres.

Az `items` a meglévő `VehicleSummary` elemeket tartalmazza, telephellyel, aktuális kilométerállással, verzióval, járművenként érvényes műveleti jogokkal és korábbi rendszámokkal. A régi `GET /api/v1/vehicles` tömbválasza kompatibilitási célból megmaradt; a webes járműlista már a lapozott végpontot használja.

## Adatvédelem és lekérdezési sorrend

1. A szolgáltatás frissen ellenőrzi a céges tagságot, a közvetlen jogokat és a jogosultságcsoportokat.
2. A `VehicleAccess.Query` először a `vehicles.read` saját telephelykorlátját alkalmazza. Más művelethez tartozó telephelyek nem szélesítik ezt a kört. A telephely nélküli autókhoz továbbra is teljes céges olvasási jog kell.
3. Ebből a körből készül az `availableTotal`, majd erre kerülnek a keresési, állapot- és telephelyfeltételek, valamint a szűrt `total`.
4. Az adatbázis rendszám, majd belső UUID alapján stabilan rendez, és `OFFSET`/`LIMIT` művelettel választja ki az oldalt. A telephely- és előzményadatokat a szolgáltatás az oldal járműveihez tölti be.
5. A teljes olvasás a meglévő céges tranzakcióban és hozzáféréskezelési zárolás mellett történik; az EF tenantszűrése és a PostgreSQL RLS is érvényesül.

A keresés a PostgreSQL beépített `pg_c_utf8` kollációját használja, ezért UTF-8 adatbázis szükséges. A projekt PostgreSQL 18 környezetével tesztelt. [PostgreSQL – kollációk](https://www.postgresql.org/docs/18/collation.html).

Nem szükséges új adatbázis-migráció ehhez a változáshoz. A lapozás az adatátvitelt és a kliensoldali feldolgozást korlátozza. A részszöveges keresés és a pontos darabszám számítása nagy állománynál továbbra is sok adatbázissort érinthet; termelési méretű adaton végzett mérés alapján érdemes később keresőindexet vagy kurzoros lapozást bevezetni.

## UX-döntések és ellenőrzés

A csatolt Automotive UX dokumentumból három elv érvényesül: **PDK** – célzott, megszakítható adatbetöltés; **Active Ride** – a meglévő `TableFrame` stabil méretezése; **iDrive/Commander** – a meglévő `Select`, `Button`, státuszjelvények és munkaterület-választó használata. A szerver válasza adja a lista és az összesítés közös alapját. Betöltés közben nincs tényként megjelenített nulla találat; hibánál a darabszám nem elérhetőként szerepel.

- PostgreSQL-es integrációs tesztek: oldalméret, sorrend, ismétlődésmentesség, régi rendszám, többmezős keresés, ékezetek, szó szerinti keresőkarakterek, kombinált szűrők, archivált járművek, céges és jogonkénti telephelykorlát, közvetlen jogok összeadódása, azonnali visszavonás és hibás paraméterek.
- Felületi tesztek: lapozás, szűrők utáni első oldal, szerveroldali régi rendszámos találat elfogadása, késleltetett keresés, megszakított régi céges kérés és típusos API-paraméterek.
- Böngészős próba 32 szintetikus járművel, külön tesztadatbázison: második oldal, korábbi rendszám, billentyűzetes állapotszűrés, betöltési és üres állapot, valamint hibaüzenet. Asztali 1440 px, tablet 768 px és mobil 390 px szélességen készült vizuális ellenőrzés; mobilon a lapozógombok egymás mellé kerültek. Mobilon és tableten nem volt vízszintes túlcsordulás.
- A hibapróba utáni külön teszt-API-újraindítást automatikus jóváhagyási ellenőrzés blokkolta (`blocked by policy`), ezért az újrapróbálás utáni böngészős helyreállást nem jelöljük ellenőrzöttnek. Ez nem érintette a meglévő fejlesztői adatokat vagy a backend integrációs tesztjeit.

Ezek célzott funkcionális ellenőrzések, nem teljes WCAG 2.2 AA audit vagy termelési terheléses teszt.
