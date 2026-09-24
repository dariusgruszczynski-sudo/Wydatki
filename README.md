# Wydatki & Oszczędności 💸

Prosta, mobilna aplikacja (PWA) do wspólnego trackowania **wydatków** i **oszczędności**
dla dwóch osób — **Darka** i **Poli**. Bez zewnętrznej bazy danych, dane trzymane w pliku
JSON na wolumenie. Jedyna zależność: `express`.

## Co potrafi

**Zakładka Pulpit (Dashboard)**
- Suma wydatków bieżącego miesiąca z porównaniem do poprzedniego (▲/▼ kwota i %).
- Poprzedni miesiąc, średnia, suma stałych płatności miesięcznych.
- Wykres słupkowy „miesiąc do miesiąca” (ostatnie 6 miesięcy).
- Porównanie kategorii bieżący vs poprzedni miesiąc (± zmiana).
- Podział wspólne/własne oraz wg osoby.

**Zakładka Wydatki**
- Dodawanie wydatku: **kwota**, **kategoria zakupów**, **osoba** (Darek/Pola),
  **konto** (🤝 wspólne / 👤 własne), data i notatka.
- **Płatności cykliczne** (abonamenty, rachunki, raty): nazwa, kwota, dzień
  miesiąca, kategoria, osoba, konto. Generują się automatycznie w dniu płatności
  (z możliwością włączenia/wyłączenia). Auto-wpisy oznaczone „🔁 cykl.".
- Zarządzanie listą kategorii (dodawanie / usuwanie).
- Podsumowanie miesięczne: suma, podział wspólne vs własne, wg osoby i wg kategorii
  (paski), przełącznik miesięcy, pełna historia z usuwaniem.

**Zakładka Oszczędności**
- Dwa niezależne **tory: Darek i Pola**.
- Wpisy dodatnie (**odłożenie / spłata**) i **ujemne** (wypłata lub start na minusie, np. `-500`).
- Raport per tor: **saldo**, **ile spłacono długu**, **ile odłożono**, wpłaty i wypłaty razem.
- Historia z filtrem po osobie.

**Mobilnie**
- Interfejs mobile-first, dolna nawigacja, instalowalny jako aplikacja na telefonie
  (PWA — „Dodaj do ekranu głównego”).

**Logowanie**
- Wspólny PIN (ustawiany w `APP_PIN`). Sesja trzymana w podpisanym ciasteczku.

---

## Uruchomienie przez Docker Compose (zalecane)

```bash
# 1. Skonfiguruj sekrety
cp .env.example .env
nano .env                     # ustaw APP_PIN i SESSION_SECRET (openssl rand -hex 32)

# 2. Zbuduj i uruchom
docker compose up -d --build

# 3. Sprawdź
docker compose logs -f
```

Domyślnie kontener słucha na **`127.0.0.1:8090`** (tylko lokalnie na serwerze) — tak, żeby
wystawić go publicznie przez Twój istniejący reverse proxy (nginx/traefik), jak reszta apek.

Aby wejść od razu po IP i porcie (bez proxy), w `docker-compose.yml` zmień:
```yaml
ports:
  - "8090:3000"     # zamiast "127.0.0.1:8090:3000"
```
i otwórz `http://46.225.229.113:8090`.

### Przykład nginx (subdomena z HTTPS)

```nginx
server {
    server_name wydatki.twojadomena.pl;

    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    # certbot dopisze tu sekcję listen 443 + certyfikaty
}
```
Przy serwowaniu po HTTPS ustaw w `.env`: `COOKIE_SECURE=1`.

---

## Uruchomienie bez Dockera (Node.js)

```bash
npm install
APP_PIN=1234 SESSION_SECRET=$(openssl rand -hex 32) PORT=8090 npm start
```

---

## Zmienne środowiskowe

| Zmienna          | Domyślnie | Opis                                                        |
|------------------|-----------|-------------------------------------------------------------|
| `APP_PIN`        | *(brak)*  | Wspólny PIN. **Puste = brak logowania** (nie na publ. IP!). |
| `SESSION_SECRET` | losowy    | Sekret do podpisu ciasteczka sesji.                         |
| `SESSION_DAYS`   | `30`      | Ile dni trzymać zalogowanie.                                |
| `COOKIE_SECURE`  | `0`       | `1` = ciasteczko tylko przez HTTPS.                         |
| `PORT`           | `3000`    | Port aplikacji (w kontenerze 3000).                         |
| `DATA_DIR`       | `./data`  | Katalog na plik `db.json`.                                  |

## Dane i kopia zapasowa

Wszystko siedzi w jednym pliku `db.json` (wolumen `wydatki_data` / katalog `DATA_DIR`).
Kopia zapasowa:
```bash
docker compose cp wydatki:/data/db.json ./backup-db.json
```

## API (skrót)

- `GET/POST/DELETE /api/expenses`, `GET /api/summary`
- `GET/POST/PATCH/DELETE /api/recurring` — płatności cykliczne
- `GET /api/dashboard` — pulpit + porównanie miesiąc do miesiąca
- `GET/POST/DELETE /api/categories`
- `GET/POST/DELETE /api/savings`, `GET /api/savings/report`
- `POST /api/auth/login|logout`, `GET /api/auth/status`
