# HERMES adatbázis-leírás és adatátadás

A dokumentum a meglévő flottakezelő adatainak HERMES-be költöztetéséhez szükséges mezőket, kapcsolatokat és betöltési sorrendet tartalmazza. Az exportban használd a forrásrendszer eredeti rekordazonosítóit. A HERMES fizikai oszlopnevei, kulcsai és korlátai a dokumentum második részében találhatók.

[Export és átadás](#export-és-átadás) · [Értékkódok](#értékkódok) · [PostgreSQL táblaleírás](#postgresql-táblaleírás)

**2026. november 23-i bővítés:** a havi pénzügyi üzemanyag-elszámolás négy új tábláját (`fuel_settlement_policies`, `fuel_settlements`, `fuel_settlement_vehicles`, `fuel_settlement_history`), az eredeti Excel-fájlok megőrzését és a külön Excel/ZIP betöltési folyamatot a [pénzügyi elszámolás leírása](FUEL_SETTLEMENTS.md#tárolás-és-naplózás) részletezi. Ezek a teljes PostgreSQL-mentés részét képezik; az általános CSV-import nem ír jóváhagyott pénzügyi elszámolást.

## Export és átadás

### Az átadandó adatok

1. A cég- és telephelytörzset, a felhasználói profilokat és a tényleges hozzáféréseket, a partnereket, valamint az összes járművet, az archiváltakat is.
2. A kapcsolódó előzményeket a teljes rendelkezésre álló időszakra. Ide tartoznak a rendszám- és km-előzmények, használók, átadások, szerződések, szervizek, foglalások, tankolások és az elérhető módosítási napló. Maradjanak benne a lemondott, érvénytelenített és visszavont tételek az eredeti állapotukkal.
3. A dokumentumok és képek tényleges fájljait, valamint egy fájljegyzéket, amely megmondja, hogy melyik rekordhoz tartoznak. Ha a forrás csak hivatkozást tárol, a hivatkozáshoz tartozó fájlt is adja át, amennyiben elérhető.
4. Egy rövid `export_meta.json` vagy szöveges jegyzéket a rendszer nevével és verziójával, az export UTC-időpontjával, a cégek és időszakok listájával, fájlonkénti rekordszámmal és a hiányzó fájlok vagy mezők felsorolásával. A több lépésben mentett táblák és csatolmányok ugyanahhoz az adatállapothoz tartozzanak.

**Ha a forrás már HERMES**, teljes átvitelhez az eredeti mentés a közvetlen út. A Debian-kiszolgáló teljes mentése az adatbázison túl a példány beállításait és a munkamenetkulcsokat is tartalmazza, és üres célra állítható vissza. Csak adatbázis átadásához a PostgreSQL egyedi formátumú `pg_dump --format=custom` mentése használható, amely a csatolmányok adatbázisban tárolt bájtjait is tartalmazza. A szerepkörök és a kiszolgáló beállításai külön kezelendők.

Adatbázis-export példája a forráshoz engedélyezett mentési szerepkörrel. A csatlakozási adatokat és a kimenetet az üzemeltető kezelje. Az archívum fiókbiztonsági adatokat is tartalmaz.

```bash
pg_dump --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" \
  --dbname=hermes --format=custom --file=hermes.dump
pg_restore --list hermes.dump
```

**Ha a forrás másik rendszer**, az alábbi oszlopneveket használd az átadáshoz. A forrás eltérő oszlopneveit az export összeállításakor feleltesd meg ezeknek a mezőknek. A HERMES üzemeltetői CSV-importálója ZIP-ből vagy mappából ellenőrzi és tölti be a csomagot, a `files.csv` szerint csatolva a fájlokat. A próbaimport a `--apply` nélküli futtatás, a tényleges betöltéshez a `--apply` kapcsoló szükséges.

### Fájlformátum és azonosítók

- UTF-8 kódolású, fejlécet tartalmazó, vesszővel tagolt CSV-t használj. Szöveges mezőnél a vesszőt, idézőjelet vagy sortörést tartalmazó érték kerüljön dupla idézőjelbe, a belső dupla idézőjelet kettőzd meg. A hiányzó érték cellája legyen üres, a valódi nulla legyen `0`, a logikai érték `true` vagy `false`.
- Nap pontosságú dátum legyen például `2026-10-15`, pontos időpont pedig `2026-10-15T08:30:00+02:00` vagy UTC-ben `2026-10-15T06:30:00Z`. A tizedesjel pont legyen, ezres elválasztó nélkül. Az irányítószámot, telefonszámot, szerződésszámot és külső azonosítót szövegként exportáld, hogy a kezdő nulla és a `+` jel megmaradjon.
- A `*_ref` hivatkozás a forrásrekord stabil azonosítója szövegként. Ha az azonosító cégenként ismétlődhet, a `company_ref` és a saját `*_ref` együtt azonosít. Minden hivatkozott rekord szerepeljen a csomagban vagy a meglévő célrekordok megfeleltetésében.
- A jármű belső kulcsa HERMES-ben UUID. A rendszám változhat, ezért a kapcsolatokhoz a forrás járműazonosítóját használd. A HERMES-fiók kulcsa a kanonikus felhasználónév, az exportban ehhez egy stabil `user_ref` tartozzon. A régi azonosítók és az új HERMES-azonosítók megfeleltetése tegye lehetővé az ismételt betöltés ellenőrzését.
- Az átvitel során megőrzendő forrásmezőkhöz használj külön `source_created_at`, `source_created_by`, `source_updated_at` és `source_updated_by` oszlopot, ahol van ilyen adat. Az ismeretlen időpontot vagy személyt hagyd üresen és jelöld a jegyzékben.

Példa arra, hogyan marad együtt ugyanaz a jármű a rendszám változásakor is.

```csv
company_ref,vehicle_ref,registration,registration_country,make,model,site_ref
ceg-01,auto-0042,AB-CD-123,HU,Škoda,Octavia,telep-03
```

```csv
company_ref,reading_ref,vehicle_ref,kilometers,recorded_at,recorded_by_ref
ceg-01,ora-0065,auto-0042,38452,2026-10-15T06:30:00Z,user-02
```

### Táblák és mezők az átadási sorrendben

A csillag az adott exporttípushoz szükséges mezőt jelöli. A többi oszlopot add át, ahol van érték. A példában látható választott oszlopok a teljes mezőlistából csak a kapcsolódást szemléltetik.

#### 1. Cégek, kapcsolattartók és telephelyek

| Fájl | Átadási mezők | HERMES cél |
| --- | --- | --- |
| `companies.csv` | `company_ref*`, `name*`, `country_code*`, `time_zone*`, `currency*`, `distance_unit*`, `legal_name`, `registration_number`, `tax_number`, `eu_vat_number`, `postal_code`, `city`, `address_line_1`, `address_line_2`, `email`, `phone`, `website`, `status`, `status_reason`, `status_changed_at` | `tenants`, `company_profiles`, `archived_tenants` |
| `company_contacts.csv` | `company_ref*`, `contact_ref*`, `name*`, `position`, `email`, `phone`, `archived_at`, `is_archived`, `status_reason` | `company_contacts` |
| `sites.csv` | `company_ref*`, `site_ref*`, `code*`, `name*`, `country_code*`, `postal_code`, `city`, `address_line_1`, `address_line_2`, `email`, `phone`, `contact_ref`, `is_archived`, `archived_at`, `status_reason` | `company_sites` |

- A telephelykód cégen belül egyedi, legfeljebb 32 karakter. Betű, szám, kötőjel és aláhúzás használható. A telephely kapcsolattartója ugyanabban a cégben legyen.
- Országkód például `HU`, pénznem `HUF` vagy `EUR`, időzóna `Europe/Budapest`, távolságegység `km` vagy `mi`. A cég állapota `Active`, `Suspended` vagy `Archived`. A jármű-, tankolás- és szerviznaplók kilométermezői kilométerben értendők.

#### 2. Fiókok és hozzáférések

| Fájl | Átadási mezők | HERMES cél |
| --- | --- | --- |
| `users.csv` | `user_ref*`, `username*`, `display_name*`, `email*`, `phone`, `is_archived`, `archived_at`, `archive_reason`, `entra_object_id` | `identity_users`, `account_lifecycles`, ellenőrzött Entra-kapcsolásnál `identity_user_logins` |
| `memberships.csv` | `company_ref*`, `user_ref*`, `is_active*`, `has_direct_access*`, `joined_at`, `disabled_at` | `tenant_memberships` |
| `member_permissions.csv` | `company_ref*`, `user_ref*`, `permission_code*` | `tenant_membership_permissions` |
| `groups.csv` | `group_ref*`, `name*`, `all_permissions`, `dashboard_mode`, `dashboard_priority` | `company_access_groups` |
| `group_companies.csv` és `group_sites.csv` | Cégkörhöz `group_ref*`, `company_ref*`, `restrict_sites*`. Korlátozott cég telephelyeihez `group_ref*`, `company_ref*`, `site_ref*`. | `company_access_scopes`, `company_access_site_scopes` |
| `group_permissions.csv` és `group_users.csv` | Jogkiosztáshoz `group_ref*`, `permission_code*`. Tagsághoz `group_ref*`, `user_ref*`. | `company_access_permissions`, `company_access_users` és a céges tagsághoz kötött kapcsolatok |
| `admin_companies.csv` | `user_ref*`, `company_ref*` a ténylegesen kezelt cégekhez. A rendszerszintű adminigényeket külön emberi jóváhagyással rögzítsétek. | `group_user_companies`, jóváhagyás után szükség esetén `system_permission_grants` |

- A felhasználónév 3–64 karakter, kisbetűs ASCII betűk, számok, pont, aláhúzás és kötőjel használható, az első karakter kisbetű vagy szám. Az e-mailnek a HERMES-ben kis- és nagybetűtől függetlenül egyedinek kell lennie. A több cégben dolgozó személynek egy fiókja és cégenként külön tagsága legyen.
- Külső rendszerből profiladatokat, jóváhagyható hozzáféréseket és szükség esetén az ellenőrzött Entra Object ID-t add át. A helyi fiók első jelszava a HERMES fióklétrehozási folyamatában készül. A régi jelszavak, hash-ek, meghívótokenek és munkamenetek a fiókexporton kívül maradnak.
- A régi rendszer szerepneveit hozzá kell rendelni a [HERMES műveleti jogaihoz](#céges-jogosultsági-kódok). Egyetlen védett `admin` csoport van, a cégeket személyenként kell kijelölni. A közvetlen tagságot, felfüggesztést és a joghoz tartozó telephelykört őrizd meg. Teljes céges járműolvasás szükséges a telephely nélküli járművekhez.
- A `dashboard_mode` értéke `Overview` vagy `Vehicle`, prioritása 0–1000. A fiók nélküli történeti szereplők az eredeti naplóazonosítójukkal megőrizhetők az átadási csomagban.

#### 3. Partnerek és járművek

| Fájl | Átadási mezők | HERMES cél |
| --- | --- | --- |
| `partners.csv` | `company_ref*`, `partner_ref*`, `name*`, `is_lessor*`, `is_service*`, `country_code*`, `postal_code`, `city`, `address_line_1`, `address_line_2`, `email`, `phone`, `website`, `notes`, `is_archived`, `status_reason` | `fleet_partners` |
| `partner_contacts.csv` | `company_ref*`, `partner_ref*`, `name*`, `position`, `email`, `phone` | A partner `ContactsJson` mezője |
| `vehicles.csv` | `company_ref*`, `vehicle_ref*`, `registration*`, `make*`, `model*`, `registration_country`, `vin`, `fleet_number`, `site_ref`, `preferred_service_partner_ref`, `status`, `status_reason`, `odometer_km` és az alábbi műszaki adatok | `vehicles`, `vehicle_profiles`, `vehicle_site_assignments` |

A jármű további mezői.

| Adatcsoport | Átadási mezők |
| --- | --- |
| Azonosítás és megjelenés | `category`, `body_type`, `year`, `first_registration`, `color` |
| Műszaki adatok | `fuel_type`, `power_kw`, `engine_capacity_cc`, `transmission`, `seats`, `gross_weight_kg`, `payload_kg`, `cargo_volume_m3`, `battery_kwh` |
| Üzemeltetés | `ownership`, `fleet_entry_date`, `fleet_exit_date`, `inspection_due_date`, `insurance_due_date`, `next_service_date`, `next_service_km`, `notes` |

- A rendszám szóközök elhagyása és nagybetűsítés után cégen belül egyedi. A kitöltött VIN és flottaazonosító szintén cégen belül egyedi. A VIN 17 karakter, az `I`, `O` és `Q` betűk, illetve a szóközök nélkül.
- Járműállapot `Active`, `Maintenance`, `Inactive` vagy `Archived`. Tulajdonlás `Owned`, `Leased`, `Rented` vagy `Unknown`. A műszaki mezők elfogadott kódjai a [járművek értékkódjainál](#járművek-értékkódjai) szerepelnek. Bizonytalan megfeleltetésnél őrizd meg a forrásértéket és jelöld az egyeztetendő listában.
- A lízingbeadó vagy szervizpartner szerep közül legalább az egyik legyen bejelölve. Partnerenként az alkalmazás legfeljebb 20 kapcsolattartót fogad. Az alapértelmezett szervizpartner ugyanahhoz a céghez tartozzon és legyen szervizpartner. Telephely nélküli járműnél a `site_ref` üres.

#### 4. Járműelőzmények, szerződések és műveletek

| Fájl | Átadási mezők | HERMES cél |
| --- | --- | --- |
| `registrations.csv` | `company_ref*`, `registration_ref*`, `vehicle_ref*`, `registration*`, `country_code*`, `recorded_at*`, `recorded_by_ref` | `vehicle_registration_history` |
| `odometer.csv` | `company_ref*`, `reading_ref*`, `vehicle_ref*`, `kilometers*`, `recorded_at*`, `recorded_by_ref` | `vehicle_odometer_readings` |
| `vehicle_users.csv` | `company_ref*`, `assignment_ref*`, `vehicle_ref*`, `user_ref*`, `assigned_at*`, `assigned_by_ref`, `released_at`, `released_by_ref` | `vehicle_user_assignments` |
| `leases.csv` | `company_ref*`, `lease_ref*`, `vehicle_ref*`, `partner_ref*`, `contract_number*`, `start_date*`, `end_date*`, `currency*`, `billing_frequency*`, `status*`, `payment_amount`, `annual_km_limit`, `total_km_limit`, `document_url`, `notes` | `vehicle_leases` |
| `services.csv` | `company_ref*`, `service_ref*`, `vehicle_ref*`, `partner_ref*`, `performed_on*`, `description*`, `currency*`, `kilometers`, `work_order_number`, `cost`, `next_service_date`, `next_service_km`, `document_url`, `notes`, `is_voided`, `void_reason` | `vehicle_services` |
| `booking_settings.csv` | `company_ref*`, `vehicle_ref*`, `enabled*` | `vehicle_booking_settings` |
| `bookings.csv` | `company_ref*`, `booking_ref*`, `vehicle_ref*`, `user_ref*`, `starts_on*`, `ends_on*`, `cancelled_at`, `cancelled_by_ref` | `vehicle_bookings` |
| `service_appointments.csv` | `company_ref*`, `vehicle_ref*`, `starts_at*`, `notes` | `vehicle_service_appointments`, járművenként egy beállított időpont |
| `fuel_entries.csv` | `company_ref*`, `fuel_ref*`, `vehicle_ref*`, `fueled_on*`, `kilometers*`, `liters*`, `amount*`, `currency*`, `recorded_by_ref`, `voided_at`, `void_reason` | `vehicle_fuel_entries`, az érvénytelenítés indoka a naplóhoz tartozik |
| `handovers.csv` | `company_ref*`, `handover_ref*`, `vehicle_ref*`, `recorded_at*`, `kilometers*`, `condition*`, `previous_user_ref`, `next_user_ref`, `recorded_by_ref`, `notes` | `vehicle_handovers`, összefügg a használói és km-előzményekkel |

- Egy járműnek egyszerre legfeljebb egy nyitott használó-hozzárendelése lehet. A lezárás időpontja az átadás után vagy azzal egy időben legyen. Ha ugyanaz a km-adat átadásban és km-naplóban is szerepel, jelöld az egyezést, hogy a betöltés egyetlen történeti leolvasásként kezelhesse.
- A foglalás mindkét szélső napot tartalmazza, legfeljebb hét naptári napos. Az azonos jármű érvényes foglalásai nem fedhetik egymást. Az eltérő régi foglalásokat egyeztetésre kell félretenni az eredeti dátumokkal.
- Az aktív lízingek nem fedhetik át egymást, és lízingelt vagy bérelt járműhöz tartozhatnak. Lízingállapot `Active`, `Closed` vagy `Cancelled`. Díjfizetési gyakoriság `Monthly`, `Quarterly`, `Annual` vagy `Upfront`. Szervizköltséget és tankolást az eredeti pénznemben add át.

#### 5. Dokumentumok és képek

A fájlok kerüljenek a csomag `files/` mappájába. A `files.csv` sorai a dokumentumra vagy képre hivatkoznak.

| Kötelező mező | További mezők |
| --- | --- |
| `file_ref`, `owner_kind`, `owner_ref`, `relative_path`, `original_name`, `sha256`, `byte_length`. A céges rekordokhoz `company_ref` is kell. | `content_type`, `category`, `uploaded_at`, `uploaded_by_ref`, `slot`, `is_withdrawn`, `status_reason`, `status_changed_at`, `status_changed_by_ref`. |

| `owner_kind` | Mire mutat az `owner_ref` és hová kerül a fájl? |
| --- | --- |
| `vehicle_document` | Jármű azonosítója. Kötelező kategória `Registration`, `Insurance` vagy `Inspection`. |
| `lease_document`, `service_document` | A szerződés vagy szervizbejegyzés azonosítója. A dokumentum metaadata a `vehicle_documents`, tartalma a `vehicle_document_contents` táblába tartozik. |
| `vehicle_photo`, `avatar` | Jármű vagy felhasználó azonosítója. Járművenként legfeljebb öt fotó, felhasználónként egy profilkép. |
| `fuel_receipt`, `handover_photo` | Tankolás vagy átadás azonosítója. A kép az adott üzleti rekordhoz tartozik. |

Egy dokumentumnak egy szülője lehet. A dokumentumfeltöltés PDF-, JPG/JPEG-, PNG-, DOCX- és XLSX-fájlokat fogad, fájlonként 10 MiB-ig, szülőnként legfeljebb 20 aktív és 100 összes fájllal, összesen 100 MiB-ig. A járműfotó, profilkép, tankolási nyugtakép és átadásfotó JPG vagy PNG, legfeljebb 5 MiB. Az átadási lenyomat az eredeti fájlra vonatkozik, a HERMES egyes képtípusokat újrakódol a feltöltéskor.

#### 6. Módosítási napló, meghívók és egyéb forrásadat

- Az `audit_events.csv` fájlban legyen `event_ref`, `occurred_at`, `action`, `entity_type` és `entity_ref`. Ha ismert, kerüljön bele a `company_ref`, a `actor_ref` és a `details_json`. A forrásnapló eseményei és az új HERMES-ben végzett műveletek időpontjai külön követhetők.
- A meghívók előzményeihez elég az érintett cég, e-mail-cím, kiosztott jogok, létrehozás, lejárat, elfogadás és visszavonás. Az aktív meghívót a célrendszer újra ki tudja állítani.
- A belső működési táblákat, például az e-mail-küldési állapotot, a jelszóváltoztatási jelzőket, a keresőmezőket és a migrációtörténetet a saját HERMES mentés őrzi. Külső forrásból a célrendszer a saját működéséhez állítja elő ezeket. Ha egy üzleti adatnak nincs célmezője, az eredeti rekordkerettel együtt az átadási csomagban maradjon.

### Próbaimport és ellenőrzés

1. **Először 5–10 összefüggő jármű mintája.** A mintához kerüljön legalább egy telephely, felhasználó, partner, csatolmány és előzmény. A mintához írd oda, mely forrástábla és mező szolgáltatja az egyes oszlopokat.
2. **Betöltés előtt ellenőrzés.** Készüljön tétellista a hiányzó kapcsolatokról, a cégen belüli duplikációkról, az érvénytelen mezőkről, az átfedő foglalásokról és az elérhetetlen fájlokról. A betöltéshez a régi és a célbeli ID-k megfeleltetését külön kell megőrizni. Az élő rendszer exportját és csatolmányait jóváhagyott, hozzáférés-védett csatornán add át.
3. **Elkülönített próba és mentés.** Futtasd le a HERMES ellenőrző importját, és javítsd a jelentett eltéréseket. Az importáló átveszi a csomagban megadott történeti dátumokat és rögzítőket. A tényleges betöltés egy adatbázis-tranzakcióban menti a cégeket és a hozzájuk tartozó csatolmányokat.
4. **Darabszámok és mintavétel.** Hasonlítsd össze cégenként és adattípusonként az exportált, betöltött és egyeztetésre maradt sorokat. Ellenőrizd a rendszámváltást, a járműhasználat előzményeit, a foglalási naptárt, a tankolási összegzést, a fájlok lenyomatát és előnézetét. A cégek és telephelyek elválasztását próba-fiókokkal ellenőrizd. Archiválás és felfüggesztés a kapcsolt rekordok rendezése után következzen.

## Értékkódok

### Járművek értékkódjai

| Átadási mező | Elfogadott értékek |
| --- | --- |
| `category` | `Unknown`, `PassengerCar`, `Van`, `Truck`, `Bus`, `Motorcycle`, `Trailer`, `Other` |
| `body_type` | `Unknown`, `Sedan`, `Hatchback`, `Estate`, `Suv`, `Coupe`, `Convertible`, `Minivan`, `Van`, `Pickup`, `ChassisCab`, `Box`, `Tipper`, `Other` |
| `fuel_type` | `Unknown`, `Petrol`, `Diesel`, `Hybrid`, `PluginHybrid`, `Electric`, `Lpg`, `Cng`, `Hydrogen`, `Other` |
| `transmission` | `Unknown`, `Manual`, `Automatic`, `Other` |
| `ownership` | `Unknown`, `Owned`, `Leased`, `Rented`, `Sold` |

A `Sold` tulajdonlás `Inactive` járműállapotot eredményez. Az archiváltként importált jármű állapota `Archived` marad.

### Céges jogosultsági kódok

A régi szerepköröket ezekre a műveleti kódokra kell megfeleltetni. A külön jóváhagyott rendszerszintű fiókkezelés kódja `system.manage`.

| Kód | Művelet |
| --- | --- |
| `audit.read` | Változásnapló megtekintése |
| `companies.read` | Cégadatok és kapcsolattartók megtekintése |
| `companies.status` | Cég felfüggesztése, archiválása és visszaállítása |
| `companies.update` | Cégadatok és kapcsolattartók szerkesztése |
| `members.invite` | Meghívások kezelése |
| `members.read` | Céges felhasználók megtekintése |
| `members.update` | Céges hozzáférések felfüggesztése és visszaállítása |
| `partners.archive` | Partner archiválása és visszaállítása |
| `partners.create` | Partner felvétele |
| `partners.read` | Partnerek és kapcsolattartók megtekintése |
| `partners.update` | Partneradatok szerkesztése |
| `permission-groups.manage` | Jogosultságcsoportok kezelése |
| `permissions.manage` | Céges jogosultságok kiosztása |
| `sites.archive` | Telephely archiválása és visszaállítása |
| `sites.create` | Telephely létrehozása |
| `sites.read` | Telephelyek megtekintése |
| `sites.update` | Telephelyadatok szerkesztése |
| `sites.vehicles.assign` | Jármű telephelyhez rendelése |
| `vehicles.archive` | Jármű archiválása és visszaállítása |
| `vehicles.bookings.create` | Jármű foglalása és saját foglalás lemondása |
| `vehicles.bookings.manage` | Járműfoglalási beállítás és foglalások kezelése |
| `vehicles.bookings.read` | Járműfoglalások megtekintése |
| `vehicles.create` | Jármű felvétele |
| `vehicles.documents.manage` | Járműokmányok kezelése |
| `vehicles.documents.read` | Járműokmányok megtekintése |
| `vehicles.fuel.manage` | Tankolások rögzítése és érvénytelenítése |
| `vehicles.fuel.read` | Tankolások és elszámolások megtekintése |
| `vehicles.leasing.manage` | Jármű lízingszerződéseinek kezelése |
| `vehicles.leasing.read` | Jármű lízingszerződéseinek megtekintése |
| `vehicles.odometer.create` | Kilométerállás rögzítése |
| `vehicles.read` | Járművek megtekintése |
| `vehicles.service.manage` | Jármű szervizbejegyzéseinek kezelése |
| `vehicles.service.read` | Jármű szervizelőzményeinek megtekintése |
| `vehicles.update` | Járműadatok szerkesztése |
| `vehicles.users.assign` | Jármű felhasználóhoz rendelése |

## PostgreSQL táblaleírás

A `public` séma 50 táblája a `20261113105709_FleetOperations` migrációig, PostgreSQL 18.7-en ellenőrizve. A leírás a migrált adatbázis katalógusából készült, és az oszlopneveket, SQL-típusokat, nullázhatóságot, alapértékeket, kulcsokat, egyedi indexeket, ellenőrző feltételeket és üzleti triggereket mutatja.

A `NOT NULL` itt tárolási szabály. Az átadási fájlokból több ilyen értéket a HERMES állít elő, például az új belső azonosítót, a normalizált keresőmezőket és a verziószámot.

Az SQL-oszlopok kis- és nagybetűi számítanak. Például a `vehicle_profiles` tábla járműkulcsa `"VehicleId"`. Az RLS a PostgreSQL sorszintű hozzáférés-védelme. Az API céges és telephelyi szabályai az RLS-es táblák felsorolásán túl is érvényesek.

### Táblajegyzék

| Tábla | Tartalom |
| --- | --- |
| [`__EFMigrationsHistory`](#efmigrationshistory) | Az EF Core által alkalmazott migrációk nyilvántartása. |
| [`access_audit_events`](#access_audit_events) | Céges jogosultsági és üzleti módosítási események, JSON-részletekkel. |
| [`account_lifecycles`](#account_lifecycles) | Fiókarchiválás és a fejlesztői fiókok jelölése. |
| [`archived_tenants`](#archived_tenants) | A felfüggesztett vagy archivált cégek állapota. |
| [`company_access_groups`](#company_access_groups) | Közös jogosultságcsoportok, a védett admin és a kezdőlap beállításai. |
| [`company_access_memberships`](#company_access_memberships) | A cégtagság és a rá érvényes jogosultságcsoport kapcsolata. |
| [`company_access_permissions`](#company_access_permissions) | Csoportok műveleti jogai. |
| [`company_access_scopes`](#company_access_scopes) | Csoportok cégei és a telephelykorlátozás jelzője. |
| [`company_access_site_scopes`](#company_access_site_scopes) | Egy csoport adott cégben kijelölt telephelyei. |
| [`company_access_users`](#company_access_users) | A felhasználó közös csoporttagsága. |
| [`company_contacts`](#company_contacts) | Céges kapcsolattartók, akikre a telephely is hivatkozhat. |
| [`company_profiles`](#company_profiles) | Cégadatok és elérhetőségek a cég alaprekordja mellett. |
| [`company_sites`](#company_sites) | Telephelyek, címek, elérhetőségek és kapcsolattartó. |
| [`fleet_partners`](#fleet_partners) | Lízing- és szervizpartnerek, a kapcsolattartókkal együtt. |
| [`group_user_companies`](#group_user_companies) | A védett admin csoport felhasználónként engedélyezett cégei. |
| [`identity_role_claims`](#identity_role_claims) | ASP.NET Identity-szerepkörhöz tartozó állítások. |
| [`identity_roles`](#identity_roles) | Az ASP.NET Identity belső szerepkörtörzse. |
| [`identity_user_claims`](#identity_user_claims) | ASP.NET Identity-fiókhoz tartozó állítások. |
| [`identity_user_logins`](#identity_user_logins) | Külső belépések, köztük a Microsoft Entra hozzárendelései. |
| [`identity_user_roles`](#identity_user_roles) | ASP.NET Identity-fiókok és Identity-szerepkörök kapcsolata. |
| [`identity_user_tokens`](#identity_user_tokens) | Az ASP.NET Identity által tárolt tokenértékek. |
| [`identity_users`](#identity_users) | Felhasználói fiókok, profilmezők és fiókbiztonsági állapot. |
| [`permission_definitions`](#permission_definitions) | A HERMES által ismert műveleti jogosultságok törzse. |
| [`system_audit_events`](#system_audit_events) | Rendszerszintű napló, opcionális cégkontextussal. |
| [`system_permission_grants`](#system_permission_grants) | Külön kiosztott rendszerszintű jogosultságok. |
| [`tenant_invitation_permissions`](#tenant_invitation_permissions) | Az egyes meghívókkal felajánlott céges jogok. |
| [`tenant_invitations`](#tenant_invitations) | Céges meghívók állapota és a token lenyomata. |
| [`tenant_membership_permissions`](#tenant_membership_permissions) | Közvetlen műveleti jogok egy cégtagsághoz. |
| [`tenant_memberships`](#tenant_memberships) | Cégtagságok, közvetlen hozzáférés és felfüggesztés. |
| [`tenants`](#tenants) | A cégek alaprekordja és időzónája. |
| [`user_avatars`](#user_avatars) | Profilképek bináris tartalma és lenyomata. |
| [`user_identity_history`](#user_identity_history) | Korábbi fiókazonosítók naplófeloldáshoz és névfoglaláshoz. |
| [`vehicle_booking_settings`](#vehicle_booking_settings) | Járművenként a foglalhatóság kapcsolója. |
| [`vehicle_bookings`](#vehicle_bookings) | Foglalási időszakok, foglalók és lemondások. |
| [`vehicle_document_contents`](#vehicle_document_contents) | A jármű-, lízing- és szervizdokumentumok fájltartalma. |
| [`vehicle_documents`](#vehicle_documents) | Dokumentumok szülőkapcsolata, metaadata és visszavonási állapota. |
| [`vehicle_fuel_entries`](#vehicle_fuel_entries) | Tankolási napló, opcionális nyugtafotóval. |
| [`vehicle_handovers`](#vehicle_handovers) | Átadási események, használók, km-állás és opcionális fotó. |
| [`vehicle_leases`](#vehicle_leases) | Lízing- és bérleti szerződések. |
| [`vehicle_model_options`](#vehicle_model_options) | Járművekből tanult gyártó- és modelljavaslatok cégenként. |
| [`vehicle_odometer_readings`](#vehicle_odometer_readings) | Kilométeróra-állások előzménye. |
| [`vehicle_photos`](#vehicle_photos) | Járműfotók a járművön belüli sorszámukkal. |
| [`vehicle_profiles`](#vehicle_profiles) | Járművek műszaki és üzemeltetési adatai. |
| [`vehicle_registration_history`](#vehicle_registration_history) | Járművek rendszámváltozásainak előzménye. |
| [`vehicle_reminder_deliveries`](#vehicle_reminder_deliveries) | Az emlékeztetők küldési és újrapróbálási állapota. |
| [`vehicle_service_appointments`](#vehicle_service_appointments) | Járművenként beállított következő szervizidőpont. |
| [`vehicle_services`](#vehicle_services) | Elvégzett szervizmunkák, költségek és érvénytelenítések. |
| [`vehicle_site_assignments`](#vehicle_site_assignments) | Járművek aktuális telephelye. |
| [`vehicle_user_assignments`](#vehicle_user_assignments) | Járművek használói és a használat időszakai. |
| [`vehicles`](#vehicles) | Járművek alaprekordja, aktuális rendszáma, állapota és km-állása. |

### Táblák részletei

#### <a id="efmigrationshistory"></a>`__EFMigrationsHistory`

Az EF Core által alkalmazott migrációk nyilvántartása.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `MigrationId` | `character varying(150)` | igen | – |
| `ProductVersion` | `character varying(32)` | igen | – |

**Kulcsok és korlátok**

```sql
PRIMARY KEY ("MigrationId")
```

#### `access_audit_events`

Céges jogosultsági és üzleti módosítási események, JSON-részletekkel.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `Id` | `uuid` | igen | – |
| `ActorSubject` | `character varying(256)` | igen | – |
| `Action` | `character varying(80)` | igen | – |
| `TargetSubject` | `character varying(256)` | – | – |
| `Details` | `jsonb` | igen | – |
| `CreatedAt` | `timestamp with time zone` | igen | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("TenantId") REFERENCES tenants("Id") ON DELETE RESTRICT
PRIMARY KEY ("TenantId", "Id")
```

Üzleti triggerek – `company_audit_append_only`.

#### `account_lifecycles`

Fiókarchiválás és a fejlesztői fiókok jelölése.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `UserId` | `text` | igen | – |
| `IsArchived` | `boolean` | igen | – |
| `DevelopmentOnly` | `boolean` | igen | – |
| `ArchivedAt` | `timestamp with time zone` | – | – |
| `Reason` | `character varying(200)` | – | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("UserId") REFERENCES identity_users("Id") ON DELETE RESTRICT
PRIMARY KEY ("UserId")
```

#### `archived_tenants`

A felfüggesztett vagy archivált cégek állapota.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `ArchivedAt` | `timestamp with time zone` | igen | – |
| `Reason` | `character varying(500)` | igen | – |
| `Status` | `character varying(16)` | igen | `'Archived'::character varying` |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("TenantId") REFERENCES tenants("Id") ON DELETE RESTRICT
PRIMARY KEY ("TenantId")
```

#### `company_access_groups`

Közös jogosultságcsoportok, a védett admin és a kezdőlap beállításai.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `Id` | `uuid` | igen | – |
| `CreatedBy` | `character varying(256)` | igen | – |
| `Name` | `character varying(80)` | igen | – |
| `NormalizedName` | `character varying(80)` | igen | – |
| `AllPermissions` | `boolean` | igen | – |
| `Version` | `bigint` | igen | – |
| `IsAdmin` | `boolean` | igen | `false` |
| `DashboardMode` | `character varying(16)` | igen | `'Overview'::character varying` |
| `DashboardPriority` | `integer` | igen | `0` |

**Kulcsok és korlátok**

```sql
CHECK ((("DashboardMode")::text = ANY ((ARRAY['Overview'::character varying, 'Vehicle'::character varying])::text[])))
CHECK ((("DashboardPriority" >= 0) AND ("DashboardPriority" <= 1000)))
PRIMARY KEY ("Id")
CREATE UNIQUE INDEX "IX_company_access_groups_IsAdmin" ON public.company_access_groups USING btree ("IsAdmin") WHERE "IsAdmin"
```

Üzleti triggerek – `unified_admin_protected`.

#### `company_access_memberships`

A cégtagság és a rá érvényes jogosultságcsoport kapcsolata.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `UserSubject` | `character varying(256)` | igen | – |
| `GroupId` | `uuid` | igen | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("GroupId") REFERENCES company_access_groups("Id") ON DELETE RESTRICT
FOREIGN KEY ("GroupId", "TenantId") REFERENCES company_access_scopes("GroupId", "TenantId") ON DELETE RESTRICT
FOREIGN KEY ("GroupId", "UserSubject") REFERENCES company_access_users("GroupId", "UserId") ON DELETE RESTRICT
FOREIGN KEY ("GroupId", "UserSubject", "TenantId") REFERENCES group_user_companies("GroupId", "UserId", "TenantId") ON DELETE RESTRICT
FOREIGN KEY ("TenantId", "UserSubject") REFERENCES tenant_memberships("TenantId", "UserSubject") ON DELETE CASCADE
PRIMARY KEY ("TenantId", "UserSubject", "GroupId")
```

#### `company_access_permissions`

Csoportok műveleti jogai.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `GroupId` | `uuid` | igen | – |
| `Code` | `character varying(80)` | igen | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("GroupId") REFERENCES company_access_groups("Id") ON DELETE CASCADE
FOREIGN KEY ("Code") REFERENCES permission_definitions("Code") ON DELETE RESTRICT
PRIMARY KEY ("GroupId", "Code")
```

#### `company_access_scopes`

Csoportok cégei és a telephelykorlátozás jelzője.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `GroupId` | `uuid` | igen | – |
| `TenantId` | `uuid` | igen | – |
| `RestrictSites` | `boolean` | igen | `false` |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("GroupId") REFERENCES company_access_groups("Id") ON DELETE CASCADE
FOREIGN KEY ("TenantId") REFERENCES tenants("Id") ON DELETE RESTRICT
PRIMARY KEY ("GroupId", "TenantId")
```

#### `company_access_site_scopes`

Egy csoport adott cégben kijelölt telephelyei.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `GroupId` | `uuid` | igen | – |
| `TenantId` | `uuid` | igen | – |
| `SiteId` | `uuid` | igen | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("GroupId", "TenantId") REFERENCES company_access_scopes("GroupId", "TenantId") ON DELETE CASCADE
FOREIGN KEY ("TenantId", "SiteId") REFERENCES company_sites("TenantId", "Id") ON DELETE RESTRICT
PRIMARY KEY ("GroupId", "TenantId", "SiteId")
```

#### `company_access_users`

A felhasználó közös csoporttagsága.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `GroupId` | `uuid` | igen | – |
| `UserId` | `character varying(256)` | igen | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("GroupId") REFERENCES company_access_groups("Id") ON DELETE CASCADE
PRIMARY KEY ("GroupId", "UserId")
```

#### `company_contacts`

Céges kapcsolattartók, akikre a telephely is hivatkozhat.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `Id` | `uuid` | igen | – |
| `Name` | `character varying(120)` | igen | – |
| `Position` | `character varying(80)` | – | – |
| `Email` | `character varying(254)` | – | – |
| `Phone` | `character varying(40)` | – | – |
| `IsArchived` | `boolean` | igen | – |
| `ArchivedAt` | `timestamp with time zone` | – | – |
| `StatusReason` | `character varying(500)` | – | – |
| `Version` | `bigint` | igen | – |
| `CreatedAt` | `timestamp with time zone` | igen | – |
| `CreatedBy` | `character varying(256)` | igen | – |
| `UpdatedAt` | `timestamp with time zone` | – | – |
| `UpdatedBy` | `character varying(256)` | – | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("TenantId") REFERENCES tenants("Id") ON DELETE RESTRICT
PRIMARY KEY ("TenantId", "Id")
```

#### `company_profiles`

Cégadatok és elérhetőségek a cég alaprekordja mellett.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `LegalName` | `character varying(200)` | – | – |
| `TaxNumber` | `character varying(40)` | – | – |
| `RegistrationNumber` | `character varying(40)` | – | – |
| `EuVatNumber` | `character varying(40)` | – | – |
| `CountryCode` | `character varying(2)` | igen | – |
| `PostalCode` | `character varying(20)` | – | – |
| `City` | `character varying(120)` | – | – |
| `AddressLine1` | `character varying(200)` | – | – |
| `AddressLine2` | `character varying(200)` | – | – |
| `Email` | `character varying(254)` | – | – |
| `Phone` | `character varying(40)` | – | – |
| `Website` | `character varying(2048)` | – | – |
| `Currency` | `character varying(3)` | igen | – |
| `DistanceUnit` | `character varying(2)` | igen | – |
| `StatusReason` | `character varying(500)` | – | – |
| `StatusChangedAt` | `timestamp with time zone` | – | – |
| `Version` | `bigint` | igen | – |
| `CreatedAt` | `timestamp with time zone` | – | – |
| `CreatedBy` | `character varying(256)` | – | – |
| `UpdatedAt` | `timestamp with time zone` | – | – |
| `UpdatedBy` | `character varying(256)` | – | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("TenantId") REFERENCES tenants("Id") ON DELETE RESTRICT
PRIMARY KEY ("TenantId")
```

#### `company_sites`

Telephelyek, címek, elérhetőségek és kapcsolattartó.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `Id` | `uuid` | igen | – |
| `Name` | `character varying(120)` | igen | – |
| `Code` | `character varying(32)` | igen | – |
| `NormalizedCode` | `character varying(32)` | igen | – |
| `CountryCode` | `character varying(2)` | igen | – |
| `PostalCode` | `character varying(20)` | – | – |
| `City` | `character varying(120)` | – | – |
| `AddressLine1` | `character varying(200)` | – | – |
| `AddressLine2` | `character varying(200)` | – | – |
| `Email` | `character varying(254)` | – | – |
| `Phone` | `character varying(40)` | – | – |
| `ContactId` | `uuid` | – | – |
| `IsArchived` | `boolean` | igen | – |
| `ArchivedAt` | `timestamp with time zone` | – | – |
| `StatusReason` | `character varying(500)` | – | – |
| `Version` | `bigint` | igen | – |
| `CreatedAt` | `timestamp with time zone` | igen | – |
| `CreatedBy` | `character varying(256)` | igen | – |
| `UpdatedAt` | `timestamp with time zone` | – | – |
| `UpdatedBy` | `character varying(256)` | – | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("TenantId", "ContactId") REFERENCES company_contacts("TenantId", "Id") ON DELETE RESTRICT
FOREIGN KEY ("TenantId") REFERENCES tenants("Id") ON DELETE RESTRICT
PRIMARY KEY ("TenantId", "Id")
CREATE UNIQUE INDEX "IX_company_sites_TenantId_NormalizedCode" ON public.company_sites USING btree ("TenantId", "NormalizedCode")
```

#### `fleet_partners`

Lízing- és szervizpartnerek, a kapcsolattartókkal együtt.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `Id` | `uuid` | igen | – |
| `Name` | `character varying(200)` | igen | – |
| `SearchText` | `character varying(400)` | igen | – |
| `IsLessor` | `boolean` | igen | – |
| `IsService` | `boolean` | igen | – |
| `CountryCode` | `character varying(2)` | igen | – |
| `PostalCode` | `character varying(20)` | – | – |
| `City` | `character varying(120)` | – | – |
| `AddressLine1` | `character varying(200)` | – | – |
| `AddressLine2` | `character varying(200)` | – | – |
| `Email` | `character varying(254)` | – | – |
| `Phone` | `character varying(40)` | – | – |
| `Website` | `character varying(2048)` | – | – |
| `Notes` | `character varying(4000)` | – | – |
| `ContactsJson` | `jsonb` | igen | – |
| `IsArchived` | `boolean` | igen | – |
| `StatusReason` | `character varying(500)` | – | – |
| `Version` | `bigint` | igen | – |
| `CreatedAt` | `timestamp with time zone` | igen | – |
| `CreatedBy` | `character varying(256)` | igen | – |
| `UpdatedAt` | `timestamp with time zone` | – | – |
| `UpdatedBy` | `character varying(256)` | – | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("TenantId") REFERENCES tenants("Id") ON DELETE RESTRICT
PRIMARY KEY ("TenantId", "Id")
```

#### `group_user_companies`

A védett admin csoport felhasználónként engedélyezett cégei.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `GroupId` | `uuid` | igen | – |
| `UserId` | `character varying(256)` | igen | – |
| `TenantId` | `uuid` | igen | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("GroupId", "TenantId") REFERENCES company_access_scopes("GroupId", "TenantId") ON DELETE RESTRICT
FOREIGN KEY ("GroupId", "UserId") REFERENCES company_access_users("GroupId", "UserId") ON DELETE RESTRICT
PRIMARY KEY ("GroupId", "UserId", "TenantId")
```

#### `identity_role_claims`

ASP.NET Identity-szerepkörhöz tartozó állítások.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `Id` | `integer` | igen | identity · BY DEFAULT |
| `RoleId` | `text` | igen | – |
| `ClaimType` | `text` | – | – |
| `ClaimValue` | `text` | – | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("RoleId") REFERENCES identity_roles("Id") ON DELETE CASCADE
PRIMARY KEY ("Id")
```

#### `identity_roles`

Az ASP.NET Identity belső szerepkörtörzse.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `Id` | `text` | igen | – |
| `Name` | `character varying(256)` | – | – |
| `NormalizedName` | `character varying(256)` | – | – |
| `ConcurrencyStamp` | `text` | – | – |

**Kulcsok és korlátok**

```sql
PRIMARY KEY ("Id")
CREATE UNIQUE INDEX "RoleNameIndex" ON public.identity_roles USING btree ("NormalizedName")
```

#### `identity_user_claims`

ASP.NET Identity-fiókhoz tartozó állítások.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `Id` | `integer` | igen | identity · BY DEFAULT |
| `UserId` | `text` | igen | – |
| `ClaimType` | `text` | – | – |
| `ClaimValue` | `text` | – | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("UserId") REFERENCES identity_users("Id") ON DELETE CASCADE
PRIMARY KEY ("Id")
```

#### `identity_user_logins`

Külső belépések, köztük a Microsoft Entra hozzárendelései.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `LoginProvider` | `text` | igen | – |
| `ProviderKey` | `text` | igen | – |
| `ProviderDisplayName` | `text` | – | – |
| `UserId` | `text` | igen | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("UserId") REFERENCES identity_users("Id") ON DELETE CASCADE
PRIMARY KEY ("LoginProvider", "ProviderKey")
```

#### `identity_user_roles`

ASP.NET Identity-fiókok és Identity-szerepkörök kapcsolata.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `UserId` | `text` | igen | – |
| `RoleId` | `text` | igen | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("RoleId") REFERENCES identity_roles("Id") ON DELETE CASCADE
FOREIGN KEY ("UserId") REFERENCES identity_users("Id") ON DELETE CASCADE
PRIMARY KEY ("UserId", "RoleId")
```

#### `identity_user_tokens`

Az ASP.NET Identity által tárolt tokenértékek.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `UserId` | `text` | igen | – |
| `LoginProvider` | `text` | igen | – |
| `Name` | `text` | igen | – |
| `Value` | `text` | – | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("UserId") REFERENCES identity_users("Id") ON DELETE CASCADE
PRIMARY KEY ("UserId", "LoginProvider", "Name")
```

#### `identity_users`

Felhasználói fiókok, profilmezők és fiókbiztonsági állapot.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `Id` | `text` | igen | – |
| `DisplayName` | `character varying(120)` | igen | – |
| `UserName` | `character varying(256)` | – | – |
| `NormalizedUserName` | `character varying(256)` | – | – |
| `Email` | `character varying(256)` | – | – |
| `NormalizedEmail` | `character varying(256)` | – | – |
| `EmailConfirmed` | `boolean` | igen | – |
| `PasswordHash` | `text` | – | – |
| `SecurityStamp` | `text` | – | – |
| `ConcurrencyStamp` | `text` | – | – |
| `PhoneNumber` | `character varying(40)` | – | – |
| `PhoneNumberConfirmed` | `boolean` | igen | – |
| `TwoFactorEnabled` | `boolean` | igen | – |
| `LockoutEnd` | `timestamp with time zone` | – | – |
| `LockoutEnabled` | `boolean` | igen | – |
| `AccessFailedCount` | `integer` | igen | – |
| `PasswordChangeRequestedAt` | `timestamp with time zone` | – | – |
| `PasswordChangeRequired` | `boolean` | igen | `false` |
| `PasswordChangedAt` | `timestamp with time zone` | – | – |
| `ProfileVersion` | `bigint` | igen | `1` |
| `AccountEmailSentAt` | `timestamp with time zone` | – | – |
| `EmailConfirmationRequired` | `boolean` | igen | `false` |

**Kulcsok és korlátok**

```sql
CHECK ((("Id" ~ '^[a-z0-9][a-z0-9._-]{2,63}$'::text) AND ("UserName" IS NOT NULL) AND (("UserName")::text = "Id") AND ("NormalizedUserName" IS NOT NULL) AND (("NormalizedUserName")::text = upper("Id"))))
PRIMARY KEY ("Id")
CREATE UNIQUE INDEX "EmailIndex" ON public.identity_users USING btree ("NormalizedEmail")
CREATE UNIQUE INDEX "UserNameIndex" ON public.identity_users USING btree ("NormalizedUserName")
```

Üzleti triggerek – `protect_username_identity`.

#### `permission_definitions`

A HERMES által ismert műveleti jogosultságok törzse.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `Code` | `character varying(80)` | igen | – |
| `Name` | `character varying(160)` | igen | – |

**Kulcsok és korlátok**

```sql
PRIMARY KEY ("Code")
```

#### `system_audit_events`

Rendszerszintű napló, opcionális cégkontextussal.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `Id` | `uuid` | igen | – |
| `ActorSubject` | `character varying(256)` | igen | – |
| `TargetSubject` | `character varying(256)` | – | – |
| `TenantId` | `uuid` | – | – |
| `Action` | `character varying(80)` | igen | – |
| `Details` | `jsonb` | igen | – |
| `CreatedAt` | `timestamp with time zone` | igen | – |

**Kulcsok és korlátok**

```sql
PRIMARY KEY ("Id")
```

Üzleti triggerek – `system_audit_append_only`.

#### `system_permission_grants`

Külön kiosztott rendszerszintű jogosultságok.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `UserId` | `text` | igen | – |
| `Code` | `character varying(80)` | igen | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("UserId") REFERENCES identity_users("Id") ON DELETE RESTRICT
PRIMARY KEY ("UserId", "Code")
```

#### `tenant_invitation_permissions`

Az egyes meghívókkal felajánlott céges jogok.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `InvitationId` | `uuid` | igen | – |
| `Code` | `character varying(80)` | igen | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("Code") REFERENCES permission_definitions("Code") ON DELETE RESTRICT
FOREIGN KEY ("TenantId", "InvitationId") REFERENCES tenant_invitations("TenantId", "Id") ON DELETE CASCADE
PRIMARY KEY ("TenantId", "InvitationId", "Code")
```

#### `tenant_invitations`

Céges meghívók állapota és a token lenyomata.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `Id` | `uuid` | igen | – |
| `Email` | `character varying(254)` | igen | – |
| `NormalizedEmail` | `character varying(254)` | igen | – |
| `TokenHash` | `character varying(64)` | igen | – |
| `InvitedBy` | `character varying(256)` | igen | – |
| `CreatedAt` | `timestamp with time zone` | igen | – |
| `ExpiresAt` | `timestamp with time zone` | igen | – |
| `AcceptedAt` | `timestamp with time zone` | – | – |
| `RevokedAt` | `timestamp with time zone` | – | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("TenantId") REFERENCES tenants("Id") ON DELETE RESTRICT
PRIMARY KEY ("TenantId", "Id")
CREATE UNIQUE INDEX "IX_tenant_invitations_TenantId_NormalizedEmail" ON public.tenant_invitations USING btree ("TenantId", "NormalizedEmail") WHERE (("AcceptedAt" IS NULL) AND ("RevokedAt" IS NULL))
```

#### `tenant_membership_permissions`

Közvetlen műveleti jogok egy cégtagsághoz.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `UserSubject` | `character varying(256)` | igen | – |
| `Code` | `character varying(80)` | igen | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("Code") REFERENCES permission_definitions("Code") ON DELETE RESTRICT
FOREIGN KEY ("TenantId", "UserSubject") REFERENCES tenant_memberships("TenantId", "UserSubject") ON DELETE CASCADE
PRIMARY KEY ("TenantId", "UserSubject", "Code")
```

#### `tenant_memberships`

Cégtagságok, közvetlen hozzáférés és felfüggesztés.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `UserSubject` | `character varying(256)` | igen | – |
| `DisabledAt` | `timestamp with time zone` | – | – |
| `IsActive` | `boolean` | igen | `true` |
| `JoinedAt` | `timestamp with time zone` | – | – |
| `Version` | `bigint` | igen | `1` |
| `HasDirectAccess` | `boolean` | igen | `true` |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("TenantId") REFERENCES tenants("Id") ON DELETE RESTRICT
PRIMARY KEY ("TenantId", "UserSubject")
```

#### `tenants`

A cégek alaprekordja és időzónája.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `Id` | `uuid` | igen | – |
| `Name` | `character varying(160)` | igen | – |
| `TimeZone` | `character varying(80)` | igen | – |

**Kulcsok és korlátok**

```sql
PRIMARY KEY ("Id")
```

#### `user_avatars`

Profilképek bináris tartalma és lenyomata.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `UserId` | `character varying(256)` | igen | – |
| `Bytes` | `bytea` | igen | – |
| `Sha256` | `character varying(64)` | igen | – |
| `UpdatedAt` | `timestamp with time zone` | igen | – |

**Kulcsok és korlátok**

```sql
CHECK (((octet_length("Bytes") >= 1) AND (octet_length("Bytes") <= 5242880)))
FOREIGN KEY ("UserId") REFERENCES identity_users("Id") ON DELETE RESTRICT
PRIMARY KEY ("UserId")
```

#### `user_identity_history`

Korábbi fiókazonosítók naplófeloldáshoz és névfoglaláshoz.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `PreviousId` | `text` | igen | – |
| `UserId` | `text` | – | – |
| `ReservedName` | `text` | igen | generált · `lower("PreviousId")` |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("UserId") REFERENCES identity_users("Id") ON DELETE RESTRICT
PRIMARY KEY ("PreviousId")
```

Üzleti triggerek – `user_identity_history_append_only`.

#### `vehicle_booking_settings`

Járművenként a foglalhatóság kapcsolója.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `VehicleId` | `uuid` | igen | – |
| `Enabled` | `boolean` | igen | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("TenantId", "VehicleId") REFERENCES vehicles("TenantId", "Id") ON DELETE RESTRICT
PRIMARY KEY ("TenantId", "VehicleId")
```

#### `vehicle_bookings`

Foglalási időszakok, foglalók és lemondások.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `Id` | `uuid` | igen | – |
| `VehicleId` | `uuid` | igen | – |
| `UserId` | `character varying(256)` | igen | – |
| `StartsOn` | `date` | igen | – |
| `EndsOn` | `date` | igen | – |
| `CancelledAt` | `timestamp with time zone` | – | – |
| `CancelledBy` | `character varying(256)` | – | – |

**Kulcsok és korlátok**

```sql
CHECK (((("EndsOn" - "StartsOn") >= 0) AND (("EndsOn" - "StartsOn") <= 6)))
FOREIGN KEY ("TenantId", "UserId") REFERENCES tenant_memberships("TenantId", "UserSubject") ON DELETE RESTRICT
FOREIGN KEY ("TenantId", "VehicleId") REFERENCES vehicles("TenantId", "Id") ON DELETE RESTRICT
PRIMARY KEY ("TenantId", "Id")
EXCLUDE USING gist ("TenantId" WITH =, "VehicleId" WITH =, daterange("StartsOn", "EndsOn", '[]'::text) WITH &&) WHERE (("CancelledAt" IS NULL))
```

#### `vehicle_document_contents`

A jármű-, lízing- és szervizdokumentumok fájltartalma.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `DocumentId` | `uuid` | igen | – |
| `Bytes` | `bytea` | igen | – |

**Kulcsok és korlátok**

```sql
CHECK (((octet_length("Bytes") >= 1) AND (octet_length("Bytes") <= 10485760)))
FOREIGN KEY ("TenantId", "DocumentId") REFERENCES vehicle_documents("TenantId", "Id") ON DELETE RESTRICT
PRIMARY KEY ("TenantId", "DocumentId")
```

Üzleti triggerek – `document_content_immutable`.

#### `vehicle_documents`

Dokumentumok szülőkapcsolata, metaadata és visszavonási állapota.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `Id` | `uuid` | igen | – |
| `LeaseId` | `uuid` | – | – |
| `ServiceId` | `uuid` | – | – |
| `FileName` | `character varying(180)` | igen | – |
| `ContentType` | `character varying(100)` | igen | – |
| `ByteLength` | `integer` | igen | – |
| `Sha256` | `character varying(64)` | igen | – |
| `UploadedBy` | `character varying(256)` | igen | – |
| `UploadedAt` | `timestamp with time zone` | igen | – |
| `Version` | `bigint` | igen | – |
| `IsWithdrawn` | `boolean` | igen | – |
| `StatusReason` | `character varying(500)` | – | – |
| `StatusChangedBy` | `character varying(256)` | – | – |
| `StatusChangedAt` | `timestamp with time zone` | – | – |
| `Category` | `character varying(32)` | – | – |
| `VehicleId` | `uuid` | – | – |

**Kulcsok és korlátok**

```sql
CHECK (((("VehicleId" IS NULL) AND ("Category" IS NULL)) OR (("VehicleId" IS NOT NULL) AND ("Category" IS NOT NULL) AND (("Category")::text = ANY ((ARRAY['Registration'::character varying, 'Insurance'::character varying, 'Inspection'::character varying])::text[])))))
CHECK (((((("LeaseId" IS NOT NULL))::integer + (("ServiceId" IS NOT NULL))::integer) + (("VehicleId" IS NOT NULL))::integer) = 1))
CHECK ((("ByteLength" >= 1) AND ("ByteLength" <= 10485760)))
FOREIGN KEY ("TenantId", "LeaseId") REFERENCES vehicle_leases("TenantId", "Id") ON DELETE RESTRICT
FOREIGN KEY ("TenantId", "ServiceId") REFERENCES vehicle_services("TenantId", "Id") ON DELETE RESTRICT
FOREIGN KEY ("TenantId", "VehicleId") REFERENCES vehicles("TenantId", "Id") ON DELETE RESTRICT
PRIMARY KEY ("TenantId", "Id")
```

Üzleti triggerek – `document_metadata_immutable`.

#### `vehicle_fuel_entries`

Tankolási napló, opcionális nyugtafotóval.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `Id` | `uuid` | igen | – |
| `VehicleId` | `uuid` | igen | – |
| `FueledOn` | `date` | igen | – |
| `Kilometers` | `bigint` | igen | – |
| `Liters` | `numeric(9,3)` | igen | – |
| `Amount` | `numeric(14,2)` | igen | – |
| `Currency` | `character varying(3)` | igen | – |
| `RecordedBy` | `character varying(256)` | igen | – |
| `Receipt` | `bytea` | – | – |
| `VoidedAt` | `timestamp with time zone` | – | – |

**Kulcsok és korlátok**

```sql
CHECK (((("Kilometers" >= 0) AND ("Kilometers" <= 100000000)) AND ("Liters" > (0)::numeric) AND ("Amount" >= (0)::numeric) AND (("Receipt" IS NULL) OR ((octet_length("Receipt") >= 1) AND (octet_length("Receipt") <= 5242880)))))
FOREIGN KEY ("TenantId", "VehicleId") REFERENCES vehicles("TenantId", "Id") ON DELETE RESTRICT
PRIMARY KEY ("TenantId", "Id")
```

#### `vehicle_handovers`

Átadási események, használók, km-állás és opcionális fotó.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `Id` | `uuid` | igen | – |
| `VehicleId` | `uuid` | igen | – |
| `PreviousUserId` | `character varying(256)` | – | – |
| `NextUserId` | `character varying(256)` | – | – |
| `RecordedBy` | `character varying(256)` | igen | – |
| `RecordedAt` | `timestamp with time zone` | igen | – |
| `Kilometers` | `bigint` | igen | – |
| `Condition` | `character varying(200)` | igen | – |
| `Notes` | `character varying(1000)` | – | – |
| `Photo` | `bytea` | – | – |

**Kulcsok és korlátok**

```sql
CHECK (((("Kilometers" >= 0) AND ("Kilometers" <= 100000000)) AND (("Photo" IS NULL) OR ((octet_length("Photo") >= 1) AND (octet_length("Photo") <= 5242880)))))
FOREIGN KEY ("TenantId", "VehicleId") REFERENCES vehicles("TenantId", "Id") ON DELETE RESTRICT
PRIMARY KEY ("TenantId", "Id")
```

Üzleti triggerek – `vehicle_handover_immutable`.

#### `vehicle_leases`

Lízing- és bérleti szerződések.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `Id` | `uuid` | igen | – |
| `VehicleId` | `uuid` | igen | – |
| `PartnerId` | `uuid` | igen | – |
| `ContractNumber` | `character varying(100)` | igen | – |
| `StartDate` | `date` | igen | – |
| `EndDate` | `date` | igen | – |
| `PaymentAmount` | `numeric(18,2)` | – | – |
| `Currency` | `character varying(3)` | igen | – |
| `BillingFrequency` | `character varying(16)` | igen | – |
| `AnnualKmLimit` | `bigint` | – | – |
| `TotalKmLimit` | `bigint` | – | – |
| `Status` | `character varying(16)` | igen | – |
| `DocumentUrl` | `character varying(2048)` | – | – |
| `Notes` | `character varying(4000)` | – | – |
| `Version` | `bigint` | igen | – |
| `CreatedAt` | `timestamp with time zone` | igen | – |
| `CreatedBy` | `character varying(256)` | igen | – |
| `UpdatedAt` | `timestamp with time zone` | – | – |
| `UpdatedBy` | `character varying(256)` | – | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("TenantId", "PartnerId") REFERENCES fleet_partners("TenantId", "Id") ON DELETE RESTRICT
FOREIGN KEY ("TenantId", "VehicleId") REFERENCES vehicles("TenantId", "Id") ON DELETE RESTRICT
PRIMARY KEY ("TenantId", "Id")
```

#### `vehicle_model_options`

Járművekből tanult gyártó- és modelljavaslatok cégenként.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `MakeKey` | `character varying(128)` | igen | – |
| `ModelKey` | `character varying(128)` | igen | – |
| `Make` | `character varying(64)` | igen | – |
| `Model` | `character varying(64)` | igen | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("TenantId") REFERENCES tenants("Id") ON DELETE RESTRICT
PRIMARY KEY ("TenantId", "MakeKey", "ModelKey")
```

#### `vehicle_odometer_readings`

Kilométeróra-állások előzménye.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `Id` | `uuid` | igen | – |
| `VehicleId` | `uuid` | igen | – |
| `Kilometers` | `bigint` | igen | – |
| `RecordedBy` | `character varying(256)` | igen | – |
| `RecordedAt` | `timestamp with time zone` | igen | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("TenantId", "VehicleId") REFERENCES vehicles("TenantId", "Id") ON DELETE RESTRICT
PRIMARY KEY ("TenantId", "Id")
```

Üzleti triggerek – `odometer_append_only`.

#### `vehicle_photos`

Járműfotók a járművön belüli sorszámukkal.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `Id` | `uuid` | igen | – |
| `VehicleId` | `uuid` | igen | – |
| `Slot` | `integer` | igen | – |
| `Bytes` | `bytea` | igen | – |
| `Sha256` | `character varying(64)` | igen | – |
| `UploadedBy` | `character varying(256)` | igen | – |
| `UploadedAt` | `timestamp with time zone` | igen | – |

**Kulcsok és korlátok**

```sql
CHECK (((octet_length("Bytes") >= 1) AND (octet_length("Bytes") <= 5242880)))
CHECK ((("Slot" >= 1) AND ("Slot" <= 5)))
FOREIGN KEY ("TenantId", "VehicleId") REFERENCES vehicles("TenantId", "Id") ON DELETE RESTRICT
PRIMARY KEY ("TenantId", "Id")
CREATE UNIQUE INDEX "IX_vehicle_photos_TenantId_VehicleId_Slot" ON public.vehicle_photos USING btree ("TenantId", "VehicleId", "Slot")
```

Üzleti triggerek – `vehicle_photo_immutable`.

#### `vehicle_profiles`

Járművek műszaki és üzemeltetési adatai.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `VehicleId` | `uuid` | igen | – |
| `RegistrationCountry` | `character varying(2)` | igen | – |
| `Vin` | `character varying(17)` | – | – |
| `FleetNumber` | `character varying(40)` | – | – |
| `Category` | `character varying(32)` | igen | – |
| `Year` | `integer` | – | – |
| `FirstRegistration` | `date` | – | – |
| `Color` | `character varying(40)` | – | – |
| `FuelType` | `character varying(32)` | igen | – |
| `PowerKw` | `numeric(12,3)` | – | – |
| `EngineCapacityCc` | `integer` | – | – |
| `Transmission` | `character varying(32)` | igen | – |
| `Seats` | `integer` | – | – |
| `GrossWeightKg` | `integer` | – | – |
| `PayloadKg` | `integer` | – | – |
| `CargoVolumeM3` | `numeric(12,3)` | – | – |
| `BatteryKwh` | `numeric(12,3)` | – | – |
| `Ownership` | `character varying(16)` | igen | – |
| `FleetEntryDate` | `date` | – | – |
| `FleetExitDate` | `date` | – | – |
| `InspectionDueDate` | `date` | – | – |
| `InsuranceDueDate` | `date` | – | – |
| `NextServiceDate` | `date` | – | – |
| `NextServiceKm` | `bigint` | – | – |
| `PreferredServicePartnerId` | `uuid` | – | – |
| `Notes` | `character varying(4000)` | – | – |
| `StatusReason` | `character varying(500)` | – | – |
| `UpdatedAt` | `timestamp with time zone` | – | – |
| `UpdatedBy` | `character varying(256)` | – | – |
| `BodyType` | `character varying(32)` | igen | `''::character varying` |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("TenantId", "PreferredServicePartnerId") REFERENCES fleet_partners("TenantId", "Id") ON DELETE RESTRICT
FOREIGN KEY ("TenantId", "VehicleId") REFERENCES vehicles("TenantId", "Id") ON DELETE RESTRICT
PRIMARY KEY ("TenantId", "VehicleId")
CREATE UNIQUE INDEX "IX_vehicle_profiles_TenantId_FleetNumber" ON public.vehicle_profiles USING btree ("TenantId", "FleetNumber") WHERE ("FleetNumber" IS NOT NULL)
CREATE UNIQUE INDEX "IX_vehicle_profiles_TenantId_Vin" ON public.vehicle_profiles USING btree ("TenantId", "Vin") WHERE ("Vin" IS NOT NULL)
```

#### `vehicle_registration_history`

Járművek rendszámváltozásainak előzménye.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `Id` | `uuid` | igen | – |
| `VehicleId` | `uuid` | igen | – |
| `Registration` | `character varying(16)` | igen | – |
| `CountryCode` | `character varying(2)` | igen | – |
| `RecordedBy` | `character varying(256)` | igen | – |
| `RecordedAt` | `timestamp with time zone` | igen | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("TenantId", "VehicleId") REFERENCES vehicles("TenantId", "Id") ON DELETE RESTRICT
PRIMARY KEY ("TenantId", "Id")
```

Üzleti triggerek – `registration_append_only`.

#### `vehicle_reminder_deliveries`

Az emlékeztetők küldési és újrapróbálási állapota.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `VehicleId` | `uuid` | igen | – |
| `UserId` | `character varying(256)` | igen | – |
| `EventKey` | `character varying(80)` | igen | – |
| `RetryAfter` | `timestamp with time zone` | igen | – |
| `Delivered` | `boolean` | igen | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("TenantId", "VehicleId") REFERENCES vehicles("TenantId", "Id") ON DELETE RESTRICT
PRIMARY KEY ("TenantId", "VehicleId", "UserId", "EventKey")
```

#### `vehicle_service_appointments`

Járművenként beállított következő szervizidőpont.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `VehicleId` | `uuid` | igen | – |
| `StartsAt` | `timestamp with time zone` | igen | – |
| `Notes` | `character varying(500)` | – | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("TenantId", "VehicleId") REFERENCES vehicles("TenantId", "Id") ON DELETE RESTRICT
PRIMARY KEY ("TenantId", "VehicleId")
```

#### `vehicle_services`

Elvégzett szervizmunkák, költségek és érvénytelenítések.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `Id` | `uuid` | igen | – |
| `VehicleId` | `uuid` | igen | – |
| `PartnerId` | `uuid` | igen | – |
| `PerformedOn` | `date` | igen | – |
| `Kilometers` | `bigint` | – | – |
| `Description` | `character varying(2000)` | igen | – |
| `WorkOrderNumber` | `character varying(100)` | – | – |
| `Cost` | `numeric(18,2)` | – | – |
| `Currency` | `character varying(3)` | igen | – |
| `NextServiceDate` | `date` | – | – |
| `NextServiceKm` | `bigint` | – | – |
| `DocumentUrl` | `character varying(2048)` | – | – |
| `Notes` | `character varying(4000)` | – | – |
| `IsVoided` | `boolean` | igen | – |
| `VoidReason` | `character varying(500)` | – | – |
| `Version` | `bigint` | igen | – |
| `CreatedAt` | `timestamp with time zone` | igen | – |
| `CreatedBy` | `character varying(256)` | igen | – |
| `UpdatedAt` | `timestamp with time zone` | – | – |
| `UpdatedBy` | `character varying(256)` | – | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("TenantId", "PartnerId") REFERENCES fleet_partners("TenantId", "Id") ON DELETE RESTRICT
FOREIGN KEY ("TenantId", "VehicleId") REFERENCES vehicles("TenantId", "Id") ON DELETE RESTRICT
PRIMARY KEY ("TenantId", "Id")
```

#### `vehicle_site_assignments`

Járművek aktuális telephelye.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `VehicleId` | `uuid` | igen | – |
| `SiteId` | `uuid` | igen | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("TenantId", "SiteId") REFERENCES company_sites("TenantId", "Id") ON DELETE RESTRICT
FOREIGN KEY ("TenantId", "VehicleId") REFERENCES vehicles("TenantId", "Id") ON DELETE RESTRICT
PRIMARY KEY ("TenantId", "VehicleId")
```

#### `vehicle_user_assignments`

Járművek használói és a használat időszakai.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `TenantId` | `uuid` | igen | – |
| `Id` | `uuid` | igen | – |
| `VehicleId` | `uuid` | igen | – |
| `UserId` | `character varying(256)` | igen | – |
| `AssignedBy` | `character varying(256)` | igen | – |
| `AssignedAt` | `timestamp with time zone` | igen | – |
| `ReleasedAt` | `timestamp with time zone` | – | – |
| `ReleasedBy` | `character varying(256)` | – | – |

**Kulcsok és korlátok**

```sql
CHECK ((("ReleasedAt" IS NULL) OR ("ReleasedAt" >= "AssignedAt")))
FOREIGN KEY ("TenantId", "UserId") REFERENCES tenant_memberships("TenantId", "UserSubject") ON DELETE RESTRICT
FOREIGN KEY ("TenantId", "VehicleId") REFERENCES vehicles("TenantId", "Id") ON DELETE RESTRICT
PRIMARY KEY ("TenantId", "Id")
CREATE UNIQUE INDEX "IX_vehicle_user_assignments_TenantId_VehicleId" ON public.vehicle_user_assignments USING btree ("TenantId", "VehicleId") WHERE ("ReleasedAt" IS NULL)
```

Üzleti triggerek – `vehicle_user_history_immutable`.

#### `vehicles`

Járművek alaprekordja, aktuális rendszáma, állapota és km-állása.

Sorszintű védelem (RLS) kényszerített.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `Id` | `uuid` | igen | – |
| `TenantId` | `uuid` | igen | – |
| `Registration` | `character varying(16)` | igen | – |
| `Make` | `character varying(64)` | igen | – |
| `Model` | `character varying(64)` | igen | – |
| `Status` | `character varying(32)` | igen | – |
| `CreatedAt` | `timestamp with time zone` | igen | – |
| `OdometerKm` | `bigint` | – | – |
| `Version` | `bigint` | igen | `1` |
| `CreatedBy` | `character varying(256)` | – | – |

**Kulcsok és korlátok**

```sql
FOREIGN KEY ("TenantId") REFERENCES tenants("Id") ON DELETE RESTRICT
PRIMARY KEY ("TenantId", "Id")
CREATE UNIQUE INDEX "IX_vehicles_TenantId_Registration" ON public.vehicles USING btree ("TenantId", "Registration")
```


## 2026. november 20-i kiegészítés: havi km-elszámolás és tankolásjavítás

A `20261120115253_MonthlyMileageAndFuelCorrections` migráció óta a `mileage_accounts`, `mileage_months` és `mileage_entries` táblák személyenként és cégenként tárolják a havi teljes és magánkilométert, a havi keretet és annak záráskori pillanatképét. A `vehicle_fuel_entries` bizonylatszámmal, teletankjelöléssel, verzióval és módosítói metaadatokkal bővült. A részletes mezők, kulcsok, importkompatibilitás és API: [Tankolás és havi km-elszámolás](MILEAGE_AND_FUEL.md#api-és-adatbázis). Ez a kiegészítés a korábbi átadási leíráshoz hozzáadódik; a korábbi CSV-oszlopok és előzményadatok megmaradnak.
