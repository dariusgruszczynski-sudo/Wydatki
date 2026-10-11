# Poker Trener v2 ♠️

Aplikacja (PWA) do nauki Texas Hold'em MTT: od podstaw do gry na kilku stołach naraz.
Działa na laptopie/tablecie (pełny układ z menu bocznym) i na telefonie (uproszczony
układ z dolną nawigacją, gesty, instalacja na ekranie głównym).

**Osobna apka, osobny kontener, osobny port (8093)** — nie dotyka `wydatki` ani innych
apek na serwerze. Mieszka w repo jako podkatalog `poker-trener/`.

## Co jest w środku

**Trening**
- Trener ICM / push-fold: 7 typów spotów — open shove, call vs shove, 3-bet shove,
  resteal, squeeze, all-in 3-way, otwarcia przy głębokich stosach.
- Formaty: MTT, PKO (bounty), SNG, satelity, winner-takes-all; etapy: chip EV, bąbelek,
  final table, heads-up; ante (BB ante / klasyczne / brak).
- Realna matematyka: ICM liczony programowaniem dynamicznym, symulacja all-in z side
  potami i bounty (Monte Carlo), próg equity ICM vs chip EV.
- Owalny stół 2–9 graczy, wypłaty i wartość ICM każdego gracza, siatka zasięgu
  przeciwnika, „co jeśli” (zmiana stosów, kart, typu przeciwnika, ante), wyjaśnienia,
  deklaracja pewności, skróty klawiszowe (S/C/R/F/Spacja), gesty na telefonie.
- Tryby: standard z filtrami i adaptacją do słabych punktów, Speed (limit czasu),
  seria, survival, time attack, wyzwanie dnia z rankingiem, powtórki błędów (jak Anki),
  tryb GTO / eksploatacja (typy przeciwników).
- Symulator całego turnieju (18/45/90 graczy, MTT/PKO) i sesja multi-table 2–3 stołów
  z asynchronicznymi decyzjami i timeoutami.
- Ćwiczenia podstaw: porównanie i nazwy układów, kolejność akcji, nuts, outy, pot odds.

**Nauka** — ścieżka 6 poziomów (Nowicjusz → Mistrz), 30 lekcji z ilustracjami i
quizami, egzaminy odblokowujące kolejne poziomy i typy spotów, test wstępny.

**Narzędzia** — kalkulator ICM, kalkulator equity (ręce i zasięgi, 2–6 graczy),
edytor zasięgów 13×13, ściągawki do druku/PDF, własny spot, eksport/backup/import.

**Dziennik** — wpisy z tagami, import historii rąk PokerStars i GGPoker, replayer,
porównanie spotów push/fold z modelem, statystyki VPIP/PFR, notatki o przeciwnikach.

**Statystyki** — raport leaków, macierz pozycja × stos, trendy, wykresy, najdroższe
błędy z powtórką, timer vs bez timera, tilt, kalibracja pewności, heatmapa rąk,
raport miesięczny do druku.

**Motywacja** — XP i poziomy, seria dni, 29 odznak, cele tygodniowe, ranking profili,
wirtualny bankroll, przypomnienia push (wymagają HTTPS).

**Bankroll** — sesje, ROI, ABI, krzywa bankrollu, planer zgodny z zasadą 100/200 ABI.

**Coach AI (opcjonalny)** — Claude: wyjaśnienia spotów, analiza rąk z dziennika, czat,
plan treningowy na tydzień, podsumowanie sesji, quiz z błędów. Wymaga
`ANTHROPIC_API_KEY`; bez klucza działają wersje regułowe (wyjaśnienia, plan, quiz).

**Profile** — kilka osób z PIN-em, osobne statystyki, wspólny ranking. Motywy: kasyno
premium, jasny, wysoki kontrast; talia 4-kolorowa; dźwięki i wibracje.

## Ważne zastrzeżenia

- To **study tool**, nie asystent do gry na żywo (RTA) — takie narzędzia są zakazane przez
  regulaminy serwisów pokerowych.
- Zasięgi przeciwników to **uproszczony model edukacyjny**, nie pełny solver GTO
  (ICMIZER, HRC, GTO Wizard). Matematyka ICM i equity jest liczona dokładnie.

## Wdrożenie (Docker Compose)

```bash
cd ~/Wydatki && git pull
cd poker-trener
cp -n .env.example .env        # przy aktualizacji zostaw istniejący .env
nano .env                      # BIND (domyślnie 0.0.0.0:8093), opcjonalnie ANTHROPIC_API_KEY
docker compose up -d --build
docker compose logs -f
```

Aktualizacja z v1: baza migruje się automatycznie przy starcie (statystyki, lekcje i
dziennik trafiają do profilu „Darek”). Pierwszy profil nie ma PIN-u — ustaw go w
Profil → Profil i PIN, zwłaszcza jeśli włączasz Coach AI.

Sprawdzenie: `curl -s http://127.0.0.1:8093/api/health` → `{"ok":true}`.

### HTTPS (zalecane)

Powiadomienia push i instalacja PWA na iPhonie wymagają HTTPS. Wystaw apkę na subdomenie
przez reverse proxy (nginx/caddy) z certyfikatem, ustaw `BIND=127.0.0.1:8093` i
`COOKIE_SECURE=1`.

## Backup

```bash
docker run --rm -v poker-trener_poker_trener_data:/data -v $(pwd):/backup alpine \
  cp /data/poker-trener.sqlite /backup/poker-trener-backup.sqlite
```
albo w aplikacji: Narzędzia → Eksport / backup.

## Uruchomienie lokalne

```bash
cd poker-trener && npm install && npm start   # http://localhost:3000
```

## Architektura

- `lib/` — silnik: `icm.js` (ICM, DP po podzbiorach), `allin.js` (symulacja all-in,
  side poty, bounty), `spots.js` (generator i rozstrzyganie spotów), `drills.js`,
  `ranges.js`, `push-fold-tables.js`, `payouts.js`, `tournament.js`, `handhistory.js`,
  `analytics.js`, `gamification.js`, `review.js`, `adaptive.js`, `coach.js`, `push.js`,
  `db.js` (SQLite `node:sqlite` + migracje), `auth.js` (profile, PIN, sesje).
- `routes/` — REST API (`/api/...`).
- `data/` — lekcje, quizy, ścieżka nauki, ranking siły rąk.
- `public/` — frontend bez frameworka (ES modules), service worker, ikony.
