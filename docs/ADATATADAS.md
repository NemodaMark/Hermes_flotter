# HERMES adatátadás és betöltési mezőlista

Ez a leírás a meglévő flottakezelő adatainak átadásához készült. A kolléga az exportot a forrásrendszer saját azonosítóival készítheti el. A HERMES céloldali táblái és pontos PostgreSQL-oszlopai a [táblaleírásban](ADATBAZIS_SEMA.md) kereshetők.

## Mit adjon át az exportáló kolléga?

1. A cég- és telephelytörzset, a felhasználói profilokat és a tényleges hozzáféréseket, a partnereket, valamint az összes járművet, az archiváltakat is.
2. A kapcsolódó előzményeket a teljes rendelkezésre álló időszakra. Ide tartoznak a rendszám- és km-előzmények, használók, átadások, szerződések, szervizek, foglalások, tankolások és az elérhető módosítási napló. Maradjanak benne a lemondott, érvénytelenített és visszavont tételek az eredeti állapotukkal.
3. A dokumentumok és képek tényleges fájljait, valamint egy fájljegyzéket, amely megmondja, hogy melyik rekordhoz tartoznak. Ha a forrás csak hivatkozást tárol, a hivatkozáshoz tartozó fájlt is adja át, amennyiben elérhető.
4. Egy rövid `export_meta.json` vagy szöveges jegyzéket a rendszer nevével és verziójával, az export UTC-időpontjával, a cégek és időszakok listájával, fájlonkénti sorszámmal és a hiányzó fájlok vagy mezők felsorolásával. A több lépésben mentett táblák és csatolmányok ugyanahhoz az adatállapothoz tartozzanak.

**Ha a forrás már HERMES**, teljes átvitelhez az eredeti mentés a közvetlen út. A Debian-kiszolgáló teljes mentése az adatbázison túl a példány beállításait és a munkamenetkulcsokat is tartalmazza, és üres célra állítható vissza. Csak adatbázis átadásához a PostgreSQL egyedi formátumú `pg_dump --format=custom` mentése használható, amely a csatolmányok adatbázisban tárolt bájtjait is tartalmazza. A szerepkörök és a kiszolgáló beállításai külön kezelendők. [HERMES visszaállítás](../deploy/debian13/README.md#teljes-helyreállítás-új-üres-célra) · [PostgreSQL pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html) · [PostgreSQL pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html)

Adatbázis-export példája a forráshoz engedélyezett mentési szerepkörrel. A csatlakozási adatokat és a kimenetet az üzemeltető kezelje. Az archívum fiókbiztonsági adatokat is tartalmaz.

```bash
pg_dump --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" \
  --dbname=hermes --format=custom --file=hermes.dump
pg_restore --list hermes.dump
```

**Ha a forrás másik rendszer**, az alábbi oszlopnevek javasolt átadási mezők. A forrás oszlopnevei maradhatnak, ha melléjük kerül a megfeleltetés. A HERMES jelenleg egyedi rögzítést és fájlfeltöltést tud. A CSV-csomag tömeges betöltéséhez a forrás ismeretében importáló szükséges.

## Fájlformátum és azonosítók

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

## Táblák és mezők az átadási sorrendben

A csillag az adott exporttípushoz szükséges mezőt jelöli. A többi oszlopot add át, ahol van érték. A példában látható választott oszlopok a teljes mezőlistából csak a kapcsolódást szemléltetik.

### 1. Cégek, kapcsolattartók és telephelyek

| Fájl | Átadási mezők | HERMES cél |
| --- | --- | --- |
| `companies.csv` | `company_ref*`, `name*`, `country_code*`, `time_zone*`, `currency*`, `distance_unit*`, `legal_name`, `registration_number`, `tax_number`, `eu_vat_number`, `postal_code`, `city`, `address_line_1`, `address_line_2`, `email`, `phone`, `website`, `status`, `status_reason`, `status_changed_at` | `tenants`, `company_profiles`, `archived_tenants` |
| `company_contacts.csv` | `company_ref*`, `contact_ref*`, `name*`, `position`, `email`, `phone`, `archived_at`, `is_archived`, `status_reason` | `company_contacts` |
| `sites.csv` | `company_ref*`, `site_ref*`, `code*`, `name*`, `country_code*`, `postal_code`, `city`, `address_line_1`, `address_line_2`, `email`, `phone`, `contact_ref`, `is_archived`, `archived_at`, `status_reason` | `company_sites` |

- A telephelykód cégen belül egyedi, legfeljebb 32 karakter. Betű, szám, kötőjel és aláhúzás használható. A telephely kapcsolattartója ugyanabban a cégben legyen.
- Országkód például `HU`, pénznem `HUF` vagy `EUR`, időzóna `Europe/Budapest`, távolságegység `km` vagy `mi`. A cég állapota `Active`, `Suspended` vagy `Archived`. A jármű-, tankolás- és szerviznaplók kilométermezői kilométerben értendők.

### 2. Fiókok és hozzáférések

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
- A régi rendszer szerepneveit hozzá kell rendelni a [HERMES műveleti jogaihoz](../backend/src/Hermes.Domain/Permissions.cs). Egyetlen védett `admin` csoport van, a cégeket személyenként kell kijelölni. A közvetlen tagságot, felfüggesztést és a joghoz tartozó telephelykört őrizd meg. Teljes céges járműolvasás szükséges a telephely nélküli járművekhez.
- A `dashboard_mode` értéke `Overview` vagy `Vehicle`, prioritása 0–1000. A fiók nélküli történeti szereplők az eredeti naplóazonosítójukkal megőrizhetők az átadási csomagban.

### 3. Partnerek és járművek

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
- Járműállapot `Active`, `Maintenance`, `Inactive` vagy `Archived`. Tulajdonlás `Owned`, `Leased`, `Rented` vagy `Unknown`. A műszaki mezőknél használt kódok a [járművalidációban](../backend/src/Hermes.Infrastructure/FleetValidation.cs) szerepelnek. Bizonytalan megfeleltetésnél őrizd meg a forrásértéket és jelöld az egyeztetendő listában.
- A lízingbeadó vagy szervizpartner szerep közül legalább az egyik legyen bejelölve. Partnerenként az alkalmazás legfeljebb 20 kapcsolattartót fogad. Az alapértelmezett szervizpartner ugyanahhoz a céghez tartozzon és legyen szervizpartner. Telephely nélküli járműnél a `site_ref` üres.

### 4. Járműelőzmények, szerződések és műveletek

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

### 5. Dokumentumok és képek

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

Egy dokumentumnak egy szülője lehet. A dokumentumfeltöltés PDF-, JPG/JPEG-, PNG-, DOCX- és XLSX-fájlokat fogad, fájlonként 10 MiB-ig, szülőnként legfeljebb 20 aktív és 100 összes fájllal, összesen 100 MiB-ig. A járműfotó, profilkép, tankolási nyugtakép és átadásfotó JPG vagy PNG, legfeljebb 5 MiB. Az átadási lenyomat az eredeti fájlra vonatkozik, a HERMES egyes képtípusokat újrakódol a feltöltéskor. [Dokumentumkorlátok](../backend/src/Hermes.Application/DocumentContracts.cs) · [Képek feldolgozása](../backend/src/Hermes.Infrastructure/ImageProcessing.cs)

### 6. Módosítási napló, meghívók és egyéb forrásadat

- Az `audit_events.csv` fájlban legyen `event_ref`, `occurred_at`, `action`, `entity_type` és `entity_ref`. Ha ismert, kerüljön bele a `company_ref`, a `actor_ref` és a `details_json`. A forrásnapló eseményei és az új HERMES-ben végzett műveletek időpontjai külön követhetők.
- A meghívók előzményeihez elég az érintett cég, e-mail-cím, kiosztott jogok, létrehozás, lejárat, elfogadás és visszavonás. Az aktív meghívót a célrendszer újra ki tudja állítani.
- A belső működési táblákat, például az e-mail-küldési állapotot, a jelszóváltoztatási jelzőket, a keresőmezőket és a migrációtörténetet a saját HERMES mentés őrzi. Külső forrásból a célrendszer a saját működéséhez állítja elő ezeket. Ha egy üzleti adatnak nincs célmezője, az eredeti rekordkerettel együtt az átadási csomagban maradjon.

## Próbaimport és ellenőrzés

1. **Először 5–10 összefüggő jármű mintája.** A mintához kerüljön legalább egy telephely, felhasználó, partner, csatolmány és előzmény. Az átadó meg tudja mutatni, melyik forrástábla és mező szolgáltatja az egyes oszlopokat.
2. **Betöltés előtt ellenőrzés.** Készüljön tétellista a hiányzó kapcsolatokról, a cégen belüli duplikációkról, az érvénytelen mezőkről, az átfedő foglalásokról és az elérhetetlen fájlokról. A betöltéshez a régi és a célbeli ID-k megfeleltetését külön kell megőrizni. Az élő rendszer exportját és csatolmányait jóváhagyott, hozzáférés-védett csatornán add át.
3. **Elkülönített cél és mentés.** A szokásos létrehozás és feltöltés a HERMES felületén vagy API-ján végezhető. A régi időbélyegek, naplóbejegyzések, korábbi lezárt foglalások és eredeti rögzítők változatlan átviteléhez célzott migráció szükséges, mert a szokásos műveletek a mostani felhasználót és időpontot használják. A táblák közvetlen, soronkénti CSV-feltöltése kihagyná az API üzleti és jogosultsági ellenőrzéseit.
4. **Darabszámok és mintavétel.** Hasonlítsd össze cégenként és adattípusonként az exportált, betöltött és egyeztetésre maradt sorokat. Ellenőrizd a rendszámváltást, a járműhasználat előzményeit, a foglalási naptárt, a tankolási összegzést, a fájlok lenyomatát és előnézetét. A cégek és telephelyek elválasztását próba-fiókokkal ellenőrizd. Archiválás és felfüggesztés a kapcsolt rekordok rendezése után következzen.

Az adatbázis pontos oszlopneveit, kulcsait és adatbázisszintű korlátait a [PostgreSQL táblaleírás](ADATBAZIS_SEMA.md) tartalmazza.
