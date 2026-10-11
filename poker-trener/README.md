# Poker Trener — ICM & Push/Fold ♠️

Samodzielna aplikacja (PWA) do nauki Texas Hold'em MTT: trener decyzji ICM/push-fold
z prawdziwą matematyką (equity liczone Monte Carlo + model ICM Malmutha-Harville'a),
lekcje teorii, quizy i dziennik rozdań. Zero zależności od zewnętrznych API/baz —
wszystko liczone lokalnie, dane trzymane w SQLite na wolumenie.

**To osobna apka, osobny kontener, osobny port** — nie ma nic wspólnego z `Wydatki`
i nie wpływa na jej działanie. Mieszka w tym repo jako podkatalog `poker-trener/`
tylko dla wygody (jeden serwer, jedno repo), ale wdraża się i działa całkowicie
niezależnie.

## Co potrafi (v1)

**Trener ICM / push-fold**
- Dwa klasyczne scenariusze treningowe: (1) Ty open-shove'ujesz, przeciwnik na BB
  decyduje o callu; (2) przeciwnik shove'uje, Ty na BB decydujesz call/fold.
- Realna matematyka: equity Twojej ręki vs zasięg przeciwnika liczone Monte Carlo
  (silnik `pokersolver`), wartość $ każdej decyzji liczona pełnym modelem ICM
  (rekurencyjny model Malmutha-Harville'a, nie uproszczony wzór).
- Zasięgi przeciwnika (szerokość % najlepszych rąk w zależności od pozycji i
  efektywnego stosu) to **uproszczony, edukacyjny model** — nie pełny solver
  GTO jak ICMIZER/HRC/GTO Wizard. Świetny do budowania nawyków i rozumienia
  ICM, ale przed grą o realne pieniądze warto zweryfikować konkretne spoty w
  profesjonalnym narzędziu.
- Tryb **Speed** — limit czasu na decyzję (15s/10s/5s). To jest trening
  "multi-tablingu": ćwiczy szybkie, poprawne decyzje pod presją czasu, bez
  symulowania kilku stołów naraz (patrz sekcja "Czego NIE robi" poniżej).
- Statystyki: trafność ogólna i wg typu decyzji, EV zgubione (w jednostkach
  ICM), wykres ostatnich 14 dni, lista ostatnich decyzji.

**Lekcje i quizy**
- 8 lekcji teorii (pozycja, pot odds/equity, ICM, push/fold, bąbelek, final
  table, zasięgi przeciwnika, mental game multi-tablingu) z krótkimi quizami.
- Progres lekcji i wyniki quizów zapisywane lokalnie.

**Dziennik rozdań**
- Manualny log rozdań (pozycja, stos, karty, board, przebieg akcji, wynik,
  notatki, tagi) do własnej analizy i wyłapywania leaków.
- To **nie jest** automatyczny import hand history z PokerStars/GGPoker/innych
  serwisów — każdy serwis ma swój format, a automatyczny parser dla kilku
  platform to osobny, większy projekt. Roadmap v2 poniżej.

## Czego NIE robi (i dlaczego to jest OK)

- **Nie czyta/nie podgląda realnych stołów w czasie gry.** To nie jest HUD ani
  real-time assistant (RTA). Narzędzia czytające ekran/dane stołu w trakcie
  gry na prawdziwe pieniądze są zakazane przez regulaminy większości
  pokerowych serwisów (PokerStars, GGPoker i inni) i grożą banem konta.
  Ta apka jest **study tool** — używasz jej między sesjami, nie podczas gry.
- **Nie renderuje 2-3 stołów naraz.** Zgodnie z ustaleniami: "multi-tabling"
  trenujemy jako szybkość i poprawność pod presją czasu (tryb Speed), nie
  jako literalny silnik wielu stołów. Jeśli kiedyś chcesz dosłowny symulator
  wielostołowy — to jest możliwe, ale to odrębny, duży projekt (własny silnik
  rozdań na kilku stołach + boty + UI przełączania) — daj znać, jeśli wracamy
  do tego tematu.
- **Nie jest certyfikowanym solverem GTO.** Zasięgi są uproszczonym modelem
  edukacyjnym (patrz wyżej).

## Roadmap v2 (niezrobione teraz, zakres na kolejne iteracje)

- Automatyczny import hand history (parser formatu [PHH](https://phh.readthedocs.io/)
  i/lub formatów konkretnych serwisów) + statystyki na realnych rozdaniach.
- Ważone zasięgi (obecnie każda kombinacja w zasięgu ma równą wagę).
- Więcej typów spotów (3-bet shove, resteal, ICM na final table 2-3 handed).
- Prawdziwy symulator multi-table (jeśli nadal potrzebny po przetestowaniu v1).

---

## Uruchomienie przez Docker Compose (zalecane)

```bash
cd poker-trener
cp .env.example .env
nano .env      # sprawdź port BIND — domyślnie 8091, musi być INNY niż Wydatki (8090)
               # i inny niż porty pozostałych apek na serwerze — sprawdź `docker ps`

docker compose up -d --build
docker compose logs -f
```

Domyślnie kontener słucha na **`127.0.0.1:8091`** (ustaw w `.env` jeśli chcesz
inaczej) — tak, żeby wystawić go publicznie przez istniejący reverse proxy
(nginx/traefik), tak jak resztę apek na `46.225.229.113`.

To osobny `docker-compose.yml`, osobny `container_name: poker-trener`, osobny
wolumen `poker_trener_data` i osobny obraz `poker-trener:latest` — uruchomienie
albo zatrzymanie tego kontenera **nie dotyka** kontenera `wydatki`.

### Przykład nginx (subdomena z HTTPS)

```nginx
server {
    server_name poker.twojadomena.pl;

    location / {
        proxy_pass http://127.0.0.1:8091;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    # certbot dopisze tu sekcję listen 443 + certyfikaty
}
```

## Uruchomienie bez Dockera (Node.js ≥ 22)

```bash
cd poker-trener
npm install
npm start
# domyślnie http://localhost:3000, dane w ./data/poker-trener.sqlite
```

Wymaga Node.js 22+ (używa wbudowanego modułu `node:sqlite` — bez żadnej
natywnej zależności do kompilacji, stąd brak `better-sqlite3`/`node-gyp`
w obrazie Dockera).

## Dane i backup

Wszystko (SQLite: statystyki trenera, progres lekcji, dziennik rozdań)
trzyma się w wolumenie Dockera `poker_trener_data` → plik `/data/poker-trener.sqlite`.
Backup:

```bash
docker run --rm -v poker-trener_poker_trener_data:/data -v $(pwd):/backup alpine \
  cp /data/poker-trener.sqlite /backup/poker-trener-backup.sqlite
```

## Architektura (dla kolejnych zmian)

- `lib/deck.js` — karty, talia, losowanie.
- `lib/equity.js` — equity Monte Carlo (ręka/zasięg vs zasięg), oparte na `pokersolver`.
- `lib/ranges.js` — 169 typów rąk startowych, ranking siły (equity vs losowa ręka,
  precomputed w `data/hand-strength-ranking.json`), budowanie zasięgu "top X%".
- `lib/push-fold-tables.js` — uproszczone tabele % shove/call wg pozycji i stosu.
- `lib/icm.js` — rekurencyjny model ICM (Malmuth-Harville), z memoizacją.
- `lib/scenarios.js` — generator scenariuszy + rozstrzyganie decyzji (EV fold vs EV agresji).
- `lib/content.js` + `data/lessons.json` + `data/quizzes.json` — treści edukacyjne.
- `lib/db.js` — SQLite (`node:sqlite`), migracje `CREATE TABLE IF NOT EXISTS`.
- `server.js` — Express, REST API + serwowanie `public/` (SPA, vanilla JS).
- `public/` — jeden responsywny frontend: pełny layout ≥900px (laptop/tablet),
  uproszczony układ z dolną nawigacją <900px (telefon) — ten sam kod, adaptacyjny CSS.
