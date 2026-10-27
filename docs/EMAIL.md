# E-mailes fiókfolyamatok és meghívók

## Működés

- **E-mail-megerősítés:** új regisztrációkra az `Accounts:RequireEmailConfirmation` kapcsolóval kötelezővé tehető. A meglévő fiókok hozzáférése megmarad. Az új, megerősítésre váró fiók regisztrációja `202` választ ad, bejelentkezési süti nélkül. A hivatkozás 24 órás; a felületen külön gombbal kell jóváhagyni, így egy levélellenőrző robot GET kérése nem fogyasztja el.
- **Elfelejtett jelszó:** a bejelentkezési oldalról kérhető, ha a levélküldés be van állítva. Az új jelszót egyórás hivatkozással lehet megadni. Siker után a hivatkozás és az összes korábbi munkamenet érvénytelenné válik; újra be kell jelentkezni. A céges tagságok, csoportok, telephelykorlátok és jogok megmaradnak. A kötelező jelszócsere teljesítetté válik, az ideiglenes belépési zárolás megszűnik. A visszaállítás önmagában nem erősíti meg az e-mail-címet.
- **Levél újrakérése:** ismeretlen, archivált, megerősített címre kért megerősítés, illetve Production környezetben fejlesztői fiók esetén sem derül ki a válaszból, létezik-e használható fiók. A fiókhoz tartozó megerősítő/visszaállító levelek között legalább egy percnek kell eltelnie, IP-alapú sebességkorlát mellett.
- **Meghívók:** mentés után a rendszer megpróbálja elküldeni a meglévő, e-mailhez kötött, 7 napos meghívóhivatkozást. Az SMTP-művelet alatt már nincs céges adatbáziszár. Sikertelen küldéskor a meghívó nem vész el; a felületen látható a hiba és másolható a hivatkozás. A meghívó elfogadásánál továbbra is a pillanatnyi delegálási jogok és telephelykorlátok döntenek.

Az SMTP-kiszolgáló átvételét jelezzük vissza, nem a postaládába érkezést. Nincs háttérsoros automatikus újrapróbálás: meghívónál kézi továbbítás, fióklevélnél újrakérés használható. Egy korábbi, még érvényes visszaállító hivatkozást az újrakérés önmagában nem von vissza; a sikeres visszaállítás minden korábbi ilyen tokent érvénytelenít.

## Beállítás

Az alapértelmezett `Email:Mode` érték `Disabled`. Ilyenkor a kézi meghívók működnek, a levélkérő API `503 email_unavailable` választ ad. Kötelező e-mail-megerősítés kikapcsolt levélküldés mellett nem engedélyezhető: a szerver induláskor elutasítja ezt a konfigurációt.

A beállítások ASP.NET Core konfigurációs kulcsok, környezeti változóban kettős aláhúzással:

| Változó | Példa / jelentés |
|---|---|
| `Email__Mode` | `Smtp`, `Pickup` vagy `Disabled` |
| `Email__PublicBaseUrl` | `https://flotta.pelda.hu` – a webes felület megbízható, üzemeltető által megadott címe |
| `Email__FromAddress` | `hermes@pelda.hu` – egyetlen feladói e-mail-cím |
| `Email__FromName` | `HERMES` |
| `Email__Host` | A szolgáltató SMTP-kiszolgálója |
| `Email__Port` | `587` StartTLS-hez, jellemzően `465` közvetlen TLS-hez |
| `Email__Security` | Kötelező `StartTls` vagy `SslOnConnect`; nincs titkosítatlan SMTP-mód |
| `Email__UserName`, `Email__Password` | Mindkettő megadandó, vagy mindkettő elhagyható hitelesítés nélküli, TLS-es belső relay esetén |
| `Accounts__RequireEmailConfirmation` | `true` esetén az ezután regisztrált fiókok nem léphetnek be megerősítés előtt; alapérték `false` |
| `Email__PickupDirectory` | Csak helyi tesztmódban: abszolút, nem nyilvánosan kiszolgált könyvtár |

A jelszó környezeti titokból vagy a futtatókörnyezet titokkezelőjéből érkezzen; ne kerüljön Gitbe, naplóba vagy frontendbe. A gyökér `.env` egy Docker/szkript bemenet, önmagában nem általános ASP.NET konfigurációs forrás. A levelezési változókat a backend folyamatának környezetébe kell átadni. Compose esetén az API-szolgáltatás `environment` részébe vagy külön, nem verziózott override-ba vehetők fel.

## Helyi próba külső levél nélkül

PowerShellben, a backend indítása előtt:

```powershell
$env:Email__Mode = 'Pickup'
$env:Email__PublicBaseUrl = 'http://127.0.0.1:5173'
$env:Email__FromAddress = 'hermes@example.test'
$env:Email__PickupDirectory = Join-Path (Get-Location) '.local/mail'
$env:Accounts__RequireEmailConfirmation = 'true'
./scripts/dev-backend.ps1
```

A `Pickup` mód csak `Development` környezetben használható. A levelek valódi MIME `.eml` fájlként jönnek létre a megadott könyvtárban. Innen megnyithatók levelezőprogrammal; a szövegben lévő hivatkozás a helyi felületre mutat. Külső szerverhez nem csatlakozik. A tesztlevelek titkos hivatkozásokat tartalmaznak: a könyvtár ne kerüljön webes kiszolgálás vagy Git alá.

## API

Minden POST művelethez a szokásos `X-CSRF-TOKEN` fejléc szükséges. A végpontok nem igényelnek bejelentkezést, sebességkorlát védi őket.

| Végpont | Kérés / válasz |
|---|---|
| `GET /api/v1/auth/options` | `emailEnabled`, `requireEmailConfirmation`; titkos SMTP-beállításokat nem ad vissza |
| `POST /api/v1/auth/forgot-password` | `{ email }`; általános `202` üzenet |
| `POST /api/v1/auth/resend-confirmation` | `{ email }`; általános `202` üzenet |
| `POST /api/v1/auth/confirm-email` | `{ userId, email, token }`; siker `200`, hibás/lejárt/használt hivatkozás `400` |
| `POST /api/v1/auth/reset-password` | `{ userId, email, token, newPassword, confirmPassword }`; 12–128 karakteres új jelszó; siker `200` |

A regisztráció megerősítési követelmény nélkül továbbra is `201` munkamenetválaszt ad. Követelménnyel `202 { requiresEmailConfirmation: true, message }` a válasz. A meghívólétrehozás `emailDelivery` mezője `sent`, `saved`, `failed` vagy `disabled`; a kézzel továbbítható `acceptance` megmaradt.

## Biztonsági és ellenőrzési részletek

- A fióktokenek ASP.NET Core Identity / Data Protection alapúak, célhoz, felhasználóhoz, e-mailhez és biztonsági bélyeghez kötve. Eltérő célra vagy más fiókhoz nem használhatók. Nem kerülnek adatbázisba vagy naplóba nyers formában.
- A hivatkozásokat kizárólag a konfigurált webcím alapján készítjük, nem a HTTP `Host` vagy továbbított fejlécekből. Production környezetben HTTPS kell; fejlesztéskor kizárólag loopback HTTP engedélyezett. Query, fragment és beágyazott hitelesítési adat nem lehet az alapcímben.
- A token az URL `#` utáni részében érkezik, ezért nem jut el a webkiszolgáló URL-naplójába vagy a Referer fejlécbe. A fiókoldal beolvasás után a címsorból is eltávolítja; nem menti localStorage-ba.
- A jelszó-visszaállítás sorzárral, tokenellenőrzéssel, profilverzió-váltással és naplózással közös tranzakcióban mentődik. A levélkérés naplója névtelen kérést jelez; token és jelszó nem szerepel benne.
- A Data Protection kulcsokat tartósan meg kell őrizni és több API-példány között meg kell osztani. Kulcsvesztéskor a korábban küldött linkek és munkamenetek érvénytelenné válhatnak.
- Az adatbázis-migráció csak két mezőt ad a felhasználókhoz: `EmailConfirmationRequired` alapértéke `false`, `AccountEmailSentAt` kezdetben `null`. Nem töröl fiókot vagy üzleti adatot.
- Integrációs tesztek ellenőrzik a token lejáratát, célhoz kötését, egyszeri használatát, a régi sütik megszűnését, a céges jogok megmaradását, az archivált és fejlesztői fiókok védelmét, a CSRF-et, a meghívási jogot és az SMTP-hibánál megmaradó meghívót. Külön teszt valódi `.eml` fájlt ír és olvas vissza, külső levelezés nélkül.

Az SMTP-szolgáltató, a feladói domain hitelesítése és a tényleges postaládás kézbesítés külön üzemeltetői beállítást/próbát igényel. Ezekhez a fejlesztés során nem küldtünk éles levelet.

Műszaki háttér: [Microsoft – Account confirmation and password recovery](https://learn.microsoft.com/aspnet/core/security/authentication/accconfirm), [MailKit](https://github.com/jstedfast/MailKit).
