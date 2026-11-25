# Hiánylista és interjúkérdések

## A szakdolgozathoz a szerzőtől szükséges

1. Milyen konkrét üzleti helyzet indította el a fejlesztést? Milyen táblázatból, papírból vagy meglévő eszközből dolgoztak, és melyik lépés volt a legnehezebben visszakereshető?
2. Mely műveletek, jogosultsági szabályok és képernyők követelményeit határoztad meg személyesen? Mely fájlok vagy commitok példázzák ezt?
3. Melyik fejlesztési részben vettél részt tervezőként, kódolóként, tesztelőként vagy döntéshozóként? Hol és milyen módon segített más résztvevő vagy AI-eszköz? Hogyan ellenőrizted a kapott eredményt?
4. Milyen konkrét alternatívát fontoltál meg a céges szétválasztásnál, a fájlok tárolásánál vagy az elszámolásnál? Mi volt a döntést eldöntő követelmény?
5. Melyik hiba vagy korábbi megoldás okozta a legtöbb újratervezést? Van hozzá napló, ticket, commit vagy saját feljegyzés?
6. Mely felhasználók próbálták a rendszert, mely funkciókat használták rendszeresen, és milyen dokumentálható visszajelzést adtak? Mi idézhető a szakdolgozatban?
7. Mely helyi vagy szerveres tesztkörnyezet írható le biztonságosan? Van ellenőrizhető telepítési, mentési vagy visszaállítási próba?
8. Volt összehasonlítható mérés az adminisztrációs időről vagy hibaesetek gyakoriságáról? Ha van, milyen időszakhoz, feladathoz és mintához tartozik?

## Ellenőrzési javaslatok

| Nyitott ügy | Következő mérés vagy igazolás | Szükséges hozzájárulás |
| --- | --- | --- |
| Élő Entra és SMTP | Sikeres, tiltott és lejárt munkamenetek próbája dedikált Entra tenantban, valamint valós SMTP-kézbesítés ellenőrzése | Tesztfiók és jóváhagyott, fiktív célpostafiók |
| Gyengébb eszközök és 3D modellvezérlés | Fizikai mobil és integrált GPU. Ismételt hideg és meleg indítás, interakciós késleltetés, memória és képkockaidő. Modellenkénti alkatrészvezérlés | Teszteszközök vagy előre egyeztetett mérőkörnyezet |
| Deploy és adatvisszaállítás | Külön Debian tesztszerver HTTPS alatt. Mentés és teljes visszaállítás új adatbázisba, majd hozzáférési és profilképpróba | Elkülönített infrastruktúra, fiktív adatmentés |
| Első API-futtatás időtúllépése | Drop-műveletek újrapróbálása izolált és párhuzamos terhelés alatt, Npgsql időzítés és `pg_stat_activity` rögzítésével | Külön tesztkörnyezet. A már sikeres kontrollált futás a viselkedési ellenőrzést biztosítja |
| Flottaesemény-kézbesítés és személyes beállítások szinkronja | Üzleti igény megerősítése, érintett adatkezelési és ütközési szabályok megadása | Termékkövetelmény jóváhagyása, ha e funkciók később napirendre kerülnek |
| Akadálymentesség és kezelhetőség | Billentyűzet, képernyőolvasó és fizikai érintős eszköz, az asztali Windows vezérlőközpont teljes kezelői bejárása | Ellenőrizhető eszköz- és feladatsor |
