# HERMES PostgreSQL táblaleírás

A `public` séma 50 táblája a `20261113105709_FleetOperations` migrációig, PostgreSQL 18.7-en ellenőrizve. A leírás a migrált adatbázis katalógusából készült, és az oszlopneveket, SQL-típusokat, nullázhatóságot, alapértékeket, kulcsokat, egyedi indexeket, ellenőrző feltételeket és üzleti triggereket mutatja.

A régi rendszer exportjához a [mezőlista és átadási sorrend](ADATATADAS.md) tartozik. A `NOT NULL` itt tárolási szabály. Az átadási fájlokból több ilyen értéket a HERMES állít elő, például az új belső azonosítót, a normalizált keresőmezőket és a verziószámot.

Az SQL-oszlopok kis- és nagybetűi számítanak. Például a `vehicle_profiles` tábla járműkulcsa `"VehicleId"`. Az RLS a PostgreSQL sorszintű hozzáférés-védelme. Az API céges és telephelyi szabályai az RLS-es táblák felsorolásán túl is érvényesek.

## Táblajegyzék

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

### <a id="efmigrationshistory"></a>`__EFMigrationsHistory`

Az EF Core által alkalmazott migrációk nyilvántartása.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `MigrationId` | `character varying(150)` | igen | – |
| `ProductVersion` | `character varying(32)` | igen | – |

**Kulcsok és korlátok**

```sql
PRIMARY KEY ("MigrationId")
```

### `access_audit_events`

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

### `account_lifecycles`

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

### `archived_tenants`

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

### `company_access_groups`

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

### `company_access_memberships`

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

### `company_access_permissions`

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

### `company_access_scopes`

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

### `company_access_site_scopes`

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

### `company_access_users`

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

### `company_contacts`

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

### `company_profiles`

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

### `company_sites`

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

### `fleet_partners`

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

### `group_user_companies`

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

### `identity_role_claims`

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

### `identity_roles`

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

### `identity_user_claims`

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

### `identity_user_logins`

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

### `identity_user_roles`

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

### `identity_user_tokens`

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

### `identity_users`

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

### `permission_definitions`

A HERMES által ismert műveleti jogosultságok törzse.

| Oszlop | PostgreSQL-típus | Kötelező | Alapérték vagy képzés |
| --- | --- | --- | --- |
| `Code` | `character varying(80)` | igen | – |
| `Name` | `character varying(160)` | igen | – |

**Kulcsok és korlátok**

```sql
PRIMARY KEY ("Code")
```

### `system_audit_events`

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

### `system_permission_grants`

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

### `tenant_invitation_permissions`

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

### `tenant_invitations`

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

### `tenant_membership_permissions`

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

### `tenant_memberships`

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

### `tenants`

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

### `user_avatars`

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

### `user_identity_history`

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

### `vehicle_booking_settings`

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

### `vehicle_bookings`

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

### `vehicle_document_contents`

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

### `vehicle_documents`

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

### `vehicle_fuel_entries`

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

### `vehicle_handovers`

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

### `vehicle_leases`

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

### `vehicle_model_options`

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

### `vehicle_odometer_readings`

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

### `vehicle_photos`

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

### `vehicle_profiles`

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

### `vehicle_registration_history`

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

### `vehicle_reminder_deliveries`

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

### `vehicle_service_appointments`

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

### `vehicle_services`

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

### `vehicle_site_assignments`

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

### `vehicle_user_assignments`

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

### `vehicles`

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
