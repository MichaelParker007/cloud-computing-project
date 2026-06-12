# Versicherungs-Hub — Session Essence (11.06.2026)

---

## Was heute gebaut wurde (Abgabe 3)

### 1. HTTPS überall
- `secure: always` in **allen** `app.yaml` Dateien → App Engine leitet HTTP → HTTPS (301)
- `_ProxyHTTPSRedirect` Middleware in FastAPI → erkennt `X-Forwarded-Proto: http` hinter Proxy → redirect
- CORS: `http://34.159.210.74:4200` (öffentliche IP über HTTP) entfernt

### 2. Microservice-Aufteilung
Drei neue Verzeichnisse unter `backend/`:

| Verzeichnis | App Engine Service | Zuständigkeit |
|---|---|---|
| `auth-service/` | `auth` | Login, JWT, 2FA, Profil, User-CRUD |
| `versicherung-service/` | `versicherung` | Versicherungen, Vorschläge, Folders, Files |
| `notification-service/` | `notification` | Platzhalter Benachrichtigungen |

Jeder Service hat: `main.py`, `app.yaml`, `requirements.txt` + auth/versicherung auch `database.py`, `models.py`.  
**Monolith `backend/main.py` bleibt produktiv und unberührt.**

### 3. Auth-Flow (4 Punkte umgesetzt)
```
Angular → Authorization: Bearer <jwt>
       → FastAPI: decode_jwt(JWT_SECRET)     ← gleicher Secret in allen Services
       → Rolle aus JWT-Payload (kein DB-Call nötig)
       → require_role("kunde"|"berater"|"admin") → 403 wenn nicht erlaubt
```
- `auth-service`: Google OAuth + Email/Passwort → JWT ausstellen, Cloud SQL User laden
- `versicherung-service`: JWT-only decode (keine Google-Fallback-Logik nötig)
- `notification-service`: JWT-only, `login: admin` in app.yaml (intern, nicht öffentlich)

### 4. Secrets konfiguriert
Alle 5 Dateien mit `JWT_SECRET` befüllt (gleicher Wert überall):
- `.env`, `backend/app.yaml`, `auth-service/app.yaml`, `versicherung-service/app.yaml`, `notification-service/app.yaml`

SMTP vollständig konfiguriert in `auth-service/app.yaml` + `backend/app.yaml`:
- Host: `server1.heimedia.de` · Port: `465` · User: `webmaster@stroucken.de`

### 5. API Gateway
```
Öffentliche URL: https://versicherung-hub-gateway-4gaq5cof.ew.gateway.dev
Backend:         https://project-64e4ee95-be58-4dea-8c0.ey.r.appspot.com
Region:          europe-west1  (europe-west3 wird von API Gateway nicht unterstützt)
Config:          versicherung-hub-config-v3
Service Account: api-gateway-sa@project-64e4ee95-be58-4dea-8c0.iam.gserviceaccount.com
```

**Dateien:**
- `api_config.yaml` — OpenAPI 2.0 Spec, alle 40 Endpunkte, Identity Platform JWT vorbereitet
- `deploy_gateway.sh` — 7-Schritte Deploy-Script (idempotent, erkennt existierende Ressourcen)

**Health-Check bestätigt:**
```bash
curl https://versicherung-hub-gateway-4gaq5cof.ew.gateway.dev/api/health
# → {"status":"Backend läuft"}  HTTP 200
```

**Behobene Deployment-Probleme:**
- `type: file` → `type: string, format: binary` (Upload-Endpunkt)
- `europe-west3` nicht unterstützt → `europe-west1`
- Config `v1`, `v2` bereits vorhanden → `v3`

### 6. TLS / Certificate Manager
Kein Certificate Manager nötig: `appspot.com` + `gateway.dev` = Google-managed TLS automatisch.  
Dokumentiert in `CLAUDE.md` + `README.md` inkl. Custom-Domain-Anleitung für die Zukunft.

### 7. Dokumentation
- `CLAUDE.md` — Architekturdiagramm, API Gateway Ressourcen-Tabelle, TLS-Sektion aktualisiert
- `README.md` — Vollständige Abgabe-3-Dokumentation (8 Abschnitte)

---

## Datei-Übersicht (neu / geändert heute)

```
cloud-computing-project/
├── api_config.yaml                  NEU  — OpenAPI 2.0 für API Gateway
├── deploy_gateway.sh                NEU  — Gateway Deploy-Script
├── README.md                        NEU  — Vollständige Abgabe-3-Doku
├── README_Essence.md                NEU  — Diese Datei
├── .env                             ✏️   — JWT_SECRET + SMTP gesetzt
├── CLAUDE.md                        ✏️   — Architektur + Gateway + TLS ergänzt
└── backend/
    ├── app.yaml                     ✏️   — secure:always, JWT_SECRET, SMTP
    ├── main.py                      ✏️   — HTTPS-Redirect-Middleware, CORS-Fix
    ├── auth-service/
    │   ├── main.py                  NEU  — Auth-Logik (Login, 2FA, Profil, Users)
    │   ├── app.yaml                 NEU  — service:auth, SMTP, JWT_SECRET
    │   ├── database.py              NEU  — Cloud SQL Connector
    │   ├── models.py                NEU  — SQLAlchemy User-Modell
    │   └── requirements.txt         NEU
    ├── versicherung-service/
    │   ├── main.py                  NEU  — Versicherungen, Vorschläge, Folders, Files
    │   ├── app.yaml                 NEU  — service:versicherung, JWT_SECRET
    │   ├── database.py              NEU
    │   ├── models.py                NEU
    │   └── requirements.txt         NEU
    └── notification-service/
        ├── main.py                  NEU  — Platzhalter /api/notify
        ├── app.yaml                 NEU  — service:notification, login:admin
        └── requirements.txt         NEU
```

---

## Schlüsselwerte (schnelle Referenz)

| Was | Wert |
|---|---|
| App Engine URL | `https://project-64e4ee95-be58-4dea-8c0.ey.r.appspot.com` |
| API Gateway URL | `https://versicherung-hub-gateway-4gaq5cof.ew.gateway.dev` |
| Project ID | `project-64e4ee95-be58-4dea-8c0` |
| Gateway Region | `europe-west1` |
| Gateway Config | `versicherung-hub-config-v3` |
| JWT Algo | HS256, 24h Ablauf, Rolle im Payload |
| Auth-Flow | Google OAuth **oder** Email+PBKDF2 → JWT → `require_role()` |
