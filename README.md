# Versicherungs-Hub — Abgabe 3: Netzwerk- und Kommunikationsarchitektur

Versicherungsverwaltungsportal für alpha Konzept.  
Projekt: `project-64e4ee95-be58-4dea-8c0` · Region: `europe-west3` (Backend) / `europe-west1` (API Gateway)

---

## Inhaltsverzeichnis

1. [Architekturübersicht](#1-architekturübersicht)
2. [Verwendete Google Cloud Dienste](#2-verwendete-google-cloud-dienste)
3. [Externe Kommunikation](#3-externe-kommunikation)
4. [Interne Kommunikation](#4-interne-kommunikation)
5. [Sicherheitsmechanismen](#5-sicherheitsmechanismen)
6. [Lokale Entwicklung](#6-lokale-entwicklung)
7. [Deployment](#7-deployment)
8. [Technische Reflexion](#8-technische-reflexion)

---

## 1. Architekturübersicht

```
Browser / Angular Frontend
  │
  │  HTTPS — TLS über Google-managed appspot.com Zertifikat
  │
  ├─► App Engine Service "frontend"
  │     https://project-64e4ee95-be58-4dea-8c0.ey.r.appspot.com
  │     Angular 17 SPA, statische Artefakte aus Cloud Storage
  │
  └─► API Gateway  (einziger öffentlicher API-Einstiegspunkt)
        https://versicherung-hub-gateway-4gaq5cof.ew.gateway.dev
        OpenAPI 2.0 Spec: api_config.yaml
        Region: europe-west1
        │
        │  x-google-backend (HTTPS, h2)
        │
        └─► App Engine Service "default"
              https://project-64e4ee95-be58-4dea-8c0.ey.r.appspot.com
              Python 3.11 · FastAPI · Gunicorn/Uvicorn
              │
              ├─ Cloud SQL (MySQL)
              │    Nutzerdaten, Rollen, Profil, 2FA, Benachrichtigungseinstellungen
              │
              ├─ Firestore (versicherung-db)
              │    Versicherungen, Vorschläge, Packages, Folders, Files
              │
              └─ Cloud Storage
                   Datei-Uploads (versicherung-hub-prod-uploads)
```

### Microservice-Aufteilung (Zielarchitektur)

Der Monolith (`backend/main.py`) wurde in drei fachlich getrennte App Engine Services aufgeteilt.
Die Services sind deploybar, teilen sich aber noch einen gemeinsamen `JWT_SECRET` und kommunizieren
noch nicht über Pub/Sub (geplant, siehe Abschnitt 4).

| Service | App Engine Service-Name | Verantwortung |
|---|---|---|
| `auth-service` | `auth` | Login (Google OAuth + Email/Passwort), JWT-Ausstellung, Profil, 2FA, Passwort-Reset, User-CRUD (Admin) |
| `versicherung-service` | `versicherung` | Versicherungen, Vorschläge, Packages, Folders, Files, Berater-Client-Zuordnung |
| `notification-service` | `notification` | Platzhalter für zukünftige Benachrichtigungen (Vertragsablauf, neue Vorschläge) |

---

## 2. Verwendete Google Cloud Dienste

| Dienst | Zweck | Status |
|---|---|---|
| **App Engine** | Hosting Backend (Python/FastAPI) und Frontend (Angular) | ✅ produktiv |
| **API Gateway** | Einziger öffentlicher Einstiegspunkt für alle `/api/*` Endpunkte | ✅ aktiv |
| **Cloud SQL (MySQL)** | Relationale Nutzerdaten: Accounts, Rollen, Profil, 2FA | ✅ produktiv |
| **Firestore** | Dokumentenbasierte Versicherungsdaten | ✅ produktiv |
| **Cloud Storage** | Frontend-Artefakte + Datei-Uploads | ✅ produktiv |
| **Identity Platform** | Authentifizierungs-Provider (Google OAuth + Email/Passwort) — Gateway vorbereitet | ⬜ POC |
| **Cloud Pub/Sub** | Asynchrone Service-zu-Service-Kommunikation (Benachrichtigungen) | ⬜ geplant |
| **Cloud Armor** | Schutz öffentlich erreichbarer Endpunkte vor DDoS / schädlichen Anfragen | ⬜ geplant |

### TLS / Certificate Manager

Die Anwendung läuft auf `*.appspot.com` und `*.gateway.dev` — beide Domains werden von Google vollständig verwaltet. Ein manueller Certificate Manager ist nicht erforderlich.

| Domain | TLS-Verwaltung |
|---|---|
| `*.appspot.com` | Google-managed, automatisch erneuert |
| `*.gateway.dev` | Google-managed, automatisch erneuert |
| Custom Domain (zukünftig) | Certificate Manager + Managed Certificate erforderlich |

---

## 3. Externe Kommunikation

### 3.1 Einstiegspunkt

Alle API-Anfragen des Angular-Frontends laufen ausschließlich über das API Gateway:

```
https://versicherung-hub-gateway-4gaq5cof.ew.gateway.dev
```

Das Gateway ist in `api_config.yaml` (OpenAPI 2.0) definiert und leitet Anfragen per
`x-google-backend` an den App Engine `default` Service weiter. Das App Engine Backend ist
zusätzlich direkt erreichbar, wird aber durch das Gateway als primärer Pfad ersetzt.

### 3.2 HTTPS

Alle extern erreichbaren Endpunkte sind ausschließlich über HTTPS erreichbar:

- **App Engine:** `secure: always` in jeder `app.yaml` erzwingt HTTPS auf Handler-Ebene.
- **FastAPI Middleware:** `_ProxyHTTPSRedirect` erkennt `X-Forwarded-Proto: http` und antwortet mit HTTP 301 auf die HTTPS-URL. Greift bei direkten HTTP-Zugriffen hinter dem Proxy.
- **API Gateway:** Akzeptiert ausschließlich HTTPS-Verbindungen (`schemes: ["https"]` in `api_config.yaml`).

### 3.3 Authentifizierung, Identifikation und Autorisierung

Das System unterscheidet drei Ebenen:

#### Authentifizierung — Wer ist der User?

Die Anwendung unterstützt zwei Login-Wege:

**Google OAuth:**
```
Angular → Google OAuth → ID Token (credential)
       → POST /api/auth/google → FastAPI verifiziert Token via google-auth
       → User in Cloud SQL anlegen / aktualisieren
       → JWT ausstellen
```

**E-Mail / Passwort:**
```
Angular → POST /api/auth/login (email + password)
       → FastAPI: PBKDF2-HMAC-SHA256 Hash-Vergleich
       → Optional: 2FA-Code per E-Mail oder TOTP (Authenticator-App)
       → JWT ausstellen
```

#### Identifikation — Wer ist der User in der Anwendung?

Nach erfolgreichem Login stellt der `auth-service` einen JWT aus:

```json
{
  "user_id": "42",
  "name": "Max Mustermann",
  "email": "max@example.de",
  "role": "kunde",
  "auth_provider": "google",
  "exp": 1234567890
}
```

Der JWT ist mit `JWT_SECRET` (HS256) signiert und 24 Stunden gültig. Jeder nachfolgende
Request sendet diesen Token im `Authorization: Bearer <jwt>` Header.

#### Autorisierung — Was darf der User?

FastAPI liest den JWT bei jeder geschützten Anfrage aus und prüft die Rolle:

```python
def get_current_user(authorization) -> User:
    # 1. JWT dekodieren (JWT_SECRET)
    # 2. User-Objekt aus Token-Payload rekonstruieren
    # Rolle ist im Token enthalten — kein DB-Call nötig

def require_role(*roles):
    # 403 wenn current_user.role nicht in erlaubten Rollen
```

| Rolle | Zugriff |
|---|---|
| `kunde` | Eigene Versicherungen, Vorschläge annehmen/ablehnen, Profil, Dokumente |
| `berater` | Alle Kundendaten, Vorschläge erstellen, Folders/Files verwalten |
| `admin` | Alle Endpunkte inkl. User-CRUD |

### 3.4 Öffentliche vs. geschützte Endpunkte

**Öffentlich (kein Token erforderlich):**

| Endpunkt | Methode | Zweck |
|---|---|---|
| `/health` | GET | Liveness-Check |
| `/api/health` | GET | API-Health |
| `/api/config` | GET | App-Konfiguration |
| `/api/auth/google` | POST | Google OAuth Login |
| `/api/auth/register` | POST | Registrierung |
| `/api/auth/login` | POST | Email/Passwort Login |
| `/api/auth/password-reset/*` | POST | Passwort zurücksetzen |
| `/api/auth/2fa/send-code` | POST | 2FA-Code senden |
| `/api/auth/2fa/verify` | POST | 2FA-Code verifizieren → JWT |

**Geschützt (JWT erforderlich, Rolle in Klammern):**

| Endpunkt | Methode | Rolle |
|---|---|---|
| `/api/me` | GET | alle |
| `/api/profile` | GET, PUT | alle |
| `/api/profile/password` | PUT | alle |
| `/api/profile/2fa/*` | POST | alle |
| `/api/profile/notifications` | PUT | alle |
| `/api/versicherungen` | GET | alle |
| `/api/versicherungen/{id}` | GET | alle |
| `/api/versicherungen/{id}/formulare` | GET, POST | alle |
| `/api/vorschlaege` | GET | alle (rollenbasiert gefiltert) |
| `/api/vorschlaege` | POST | berater, admin |
| `/api/vorschlaege/{id}/annehmen` | POST | kunde |
| `/api/vorschlaege/{id}/ablehnen` | POST | kunde |
| `/api/packages` | GET | alle |
| `/api/packages` | POST | berater, admin |
| `/api/folders` | GET, POST | alle / berater, admin |
| `/api/files` | GET | alle |
| `/api/files/upload` | POST | alle |
| `/api/files/{id}` | DELETE | berater, admin |
| `/api/berater/clients` | GET, POST | berater, admin |
| `/api/users` | GET, POST, PUT, DELETE | admin |

---

## 4. Interne Kommunikation

### 4.1 Serviceaufteilung

```
auth-service         versicherung-service     notification-service
     │                       │                        │
     │ JWT_SECRET (shared)   │ JWT_SECRET (shared)    │ login: admin
     │                       │                        │
     └──── Cloud SQL ────────┘                        │
     (auth liest/schreibt)   (liest für Vorschläge)   │
                             │                        │
                             └──── Firestore ─────────┘ (zukünftig)
```

Jeder Service dekodiert den JWT eigenständig mit dem gemeinsamen `JWT_SECRET` — kein
Service-zu-Service-Call nötig für Authentifizierung. Die Rolle steht im JWT-Payload.

### 4.2 Geplante asynchrone Kommunikation via Pub/Sub

Der `notification-service` ist als Platzhalter für ereignisgetriebene Benachrichtigungen
vorbereitet. Die geplante Architektur:

```
versicherung-service                notification-service
       │                                    │
       │  Pub/Sub Topic:                    │
       │  "vorschlag-angenommen"  ──────►   │  Subscriber:
       │  "vertragsablauf-naht"   ──────►   │  User-Präferenzen aus auth-service laden
       │  "neuer-vorschlag"       ──────►   │  E-Mail via SMTP senden
       │                                    │
       └────────────────────────────────────┘
```

**Geplante Pub/Sub Topics:**

| Topic | Publisher | Subscriber | Auslöser |
|---|---|---|---|
| `vorschlag-angenommen` | versicherung-service | notification-service | Kunde nimmt Vorschlag an |
| `neuer-vorschlag` | versicherung-service | notification-service | Berater sendet Vorschlag |
| `vertragsablauf-naht` | versicherung-service (Scheduler) | notification-service | Vertrag läuft in 30 Tagen ab |

**Begründung asynchron:** Benachrichtigungen sind nicht zeitkritisch und sollen den
eigentlichen Geschäftsvorgang nicht blockieren. Ein Fehler im E-Mail-Versand darf nicht
dazu führen, dass eine Vertragsannahme fehlschlägt (lose Kopplung).

### 4.3 Synchrone Service-zu-Service-Aufrufe

Ein direkter synchroner Aufruf ist aktuell noch vorhanden:

| Von | Nach | Endpunkt | Grund |
|---|---|---|---|
| `versicherung-service` | Cloud SQL (direkt) | Kunde per Email suchen | `POST /api/vorschlaege` benötigt die `user_id` des Kunden |

**Begründung synchron:** Die `user_id` des Kunden ist für die Firestore-Speicherung des
Vorschlags unmittelbar erforderlich — der Vorgang kann ohne sie nicht abgeschlossen werden.
Langfristig: Ersetzen durch HTTP-Call zu `auth-service GET /api/users?email=...`.

### 4.4 Sicherheit interner Kommunikation

| Mechanismus | Anwendung |
|---|---|
| Gemeinsamer `JWT_SECRET` | Alle Services können vom `auth-service` ausgestellte JWTs eigenständig validieren |
| `login: admin` (App Engine) | `notification-service` ist nur für GCP-Projekt-Admins erreichbar — kein öffentlicher Zugriff |
| Service Account `api-gateway-sa` | API Gateway authentifiziert sich gegenüber App Engine via Service Account |
| CORS-Whitelist | Nur `appspot.com` und `localhost:4200` als erlaubte Origins |

---

## 5. Sicherheitsmechanismen

| Mechanismus | Komponente | Beschreibung |
|---|---|---|
| HTTPS everywhere | App Engine, API Gateway | `secure: always` + Redirect-Middleware, TLS via Google-managed Zertifikat |
| JWT (HS256) | auth-service → alle Services | Signierter Token mit Ablaufzeit (24h), Rolle im Payload |
| Passwort-Hashing | auth-service | PBKDF2-HMAC-SHA256 mit Salt (100.000 Iterationen) |
| 2FA | auth-service | E-Mail-Code oder TOTP (RFC 6238, Authenticator-App) |
| Rollenbasierte Autorisierung | alle Services | `require_role()` Dependency — 403 bei fehlender Rolle |
| CORS-Restriktion | alle Services | Whitelist: `appspot.com`, `localhost:4200` |
| Service Account | API Gateway | `api-gateway-sa` mit minimalen IAM-Rollen |
| Interner Service-Schutz | notification-service | `login: admin` — nur GCP-Admins erreichbar |
| Parametrisierte SQL-Queries | auth-service | Kein String-Concatenation, kein SQL-Injection-Risiko |
| Secrets aus Umgebungsvariablen | alle | `JWT_SECRET`, `DB_PASS`, `SMTP_PASS` nie im Code |

### Geplant (nicht implementiert)
- **Cloud Armor:** WAF-Schutz vor DDoS, SQL-Injection, XSS für den API-Gateway-Endpunkt
- **VPC / Private Service Connect:** Direkte DB-Verbindung ohne öffentliches Internet
- **Identity-Aware Proxy:** Für interne Admin-Tools

---

## 6. Lokale Entwicklung

### Voraussetzungen

```bash
# Google Cloud SDK
gcloud auth application-default login
gcloud config set project project-64e4ee95-be58-4dea-8c0

# Python 3.11
pip install -r backend/requirements.txt

# Node.js 18+
cd frontend && npm install
```

### Backend starten

```bash
cd backend
uvicorn main:app --reload --port 5001
# → http://localhost:5001
# (Port 5000 auf macOS blockiert)
```

### Frontend starten

```bash
cd frontend
npm start
# → http://localhost:4200
```

### Docker Compose (beides zusammen)

```bash
docker compose up --build
# Frontend: http://localhost:4200
# Backend:  http://localhost:5001
```

### Umgebungsvariablen (.env)

```env
GOOGLE_CLIENT_ID=348933755247-43f27tovii99ekmu8c80jveld7jn1k21.apps.googleusercontent.com
FIRESTORE_PROJECT_ID=project-64e4ee95-be58-4dea-8c0
FIRESTORE_DATABASE=versicherung-db
JWT_SECRET=<gemeinsames Secret für alle Services>
SMTP_HOST=server1.heimedia.de
SMTP_PORT=465
SMTP_USER=webmaster@stroucken.de
SMTP_PASS=<SMTP-Passwort>
SMTP_FROM=webmaster@stroucken.de
```

---

## 7. Deployment

### Backend (App Engine `default` Service)

```bash
cd backend
gcloud app deploy
```

### Frontend (App Engine `frontend` Service + Cloud Storage)

```bash
cd frontend
npm run build
gcloud storage cp -r dist/frontend/browser/* gs://versicherung-frontend-storage/
```

### API Gateway

```bash
# Erstmalig oder nach Änderung an api_config.yaml:
chmod +x deploy_gateway.sh
./deploy_gateway.sh

# Bei Konfigurationsänderung: CONFIG_ID in deploy_gateway.sh erhöhen (v3 → v4)
```

### Neue Microservices deployen (auth / versicherung / notification)

```bash
# Beispiel auth-service:
cd backend/auth-service
gcloud app deploy
# App Engine erkennt service: auth aus app.yaml → eigene URL:
# https://auth-dot-project-64e4ee95-be58-4dea-8c0.ey.r.appspot.com
```

### Health-Checks

```bash
# Aktueller Monolith (produktiv)
curl https://project-64e4ee95-be58-4dea-8c0.ey.r.appspot.com/api/health
# → {"status":"Backend läuft"}

# API Gateway
curl https://versicherung-hub-gateway-4gaq5cof.ew.gateway.dev/api/health
# → {"status":"Backend läuft"}
```

### Rollback

```bash
# App Engine auf ältere Version zurückschalten
gcloud app services set-traffic default --splits=20260529t115421=1

# API Gateway auf ältere Config zurückschalten
gcloud api-gateway gateways update versicherung-hub-gateway \
  --api=versicherung-hub-api \
  --api-config=versicherung-hub-config-v2 \
  --location=europe-west1
```

---

## 8. Technische Reflexion

### Kommunikationsformen im Vergleich

| Kriterium | HTTPS / REST (synchron) | Pub/Sub (asynchron) |
|---|---|---|
| **Sicherheit** | TLS-verschlüsselt, JWT-validiert am Gateway und im Backend; Angriffsfläche durch öffentliche Endpunkte | Intern, kein öffentlicher Endpunkt; IAM-basierte Publisher/Subscriber-Kontrolle |
| **Kopplung** | Eng: Aufrufer wartet auf Antwort; Ausfall des Ziels blockiert den Aufrufer | Lose: Publisher kennt Subscriber nicht; Ausfall des Subscribers blockiert nicht |
| **Fehlertoleranz** | Einzelner Endpunkt-Ausfall → direkte Fehlerantwort an den Client | Nachrichten bleiben im Topic bis Subscriber bereit; automatischer Retry |
| **Betriebsaufwand** | Gering: App Engine verwaltet Skalierung automatisch | Höher: Topics, Subscriptions und Dead-Letter-Queues müssen konfiguriert werden |
| **Latenz** | Niedrig: direkte Antwort | Höher: Nachricht landet erst im Topic, dann beim Subscriber |
| **Typische Einsatzszenarien** | Login, Datenabruf, Formulare, alles was sofort eine Antwort braucht | Benachrichtigungen, Audit-Logs, Datenabgleich zwischen Services, nicht zeitkritische Hintergrundaufgaben |

### Architekturentscheidungen

**Warum API Gateway vor App Engine?**
App Engine ist direkt über die `appspot.com`-URL erreichbar. Das API Gateway schafft einen
kontrollierten, dokumentierten Einstiegspunkt mit OpenAPI-Spec, zentraler Authentifizierungs-
konfiguration und der Möglichkeit, später Cloud Armor oder Rate Limiting vorgelagert
einzusetzen — ohne den Backend-Code anfassen zu müssen.

**Warum JWT statt Session-Cookies?**
Das System ist stateless: jeder Service kann einen JWT eigenständig validieren, ohne eine
zentrale Session-Datenbank abzufragen. Das vereinfacht die horizontale Skalierung und die
Microservice-Aufteilung — der `versicherung-service` braucht keinen Call zum `auth-service`
für jede Anfrage.

**Warum Rolle im JWT-Payload statt in der DB?**
Eine DB-Abfrage pro Request für die Rollenprüfung wäre ein Performance- und Kopplungs-Problem.
Der Trade-off: Rollenwechsel greifen erst nach JWT-Ablauf (24h). Für einen
Versicherungskontext ist das akzeptabel.

**Warum synchron für `POST /api/vorschlaege`?**
Die `user_id` des Kunden ist für die Firestore-Speicherung unmittelbar erforderlich und
muss korrekt sein. Ein asynchrones Muster würde eine nachträgliche Verknüpfung erfordern,
die Komplexität erhöht und Datenkonsistenz gefährdet. Synchron ist hier fachlich korrekt.

**Warum asynchron für Benachrichtigungen (geplant)?**
Eine fehlgeschlagene E-Mail-Zustellung darf nicht dazu führen, dass eine Vertragsannahme
zurückgerollt wird. Pub/Sub entkoppelt den Geschäftsvorgang vom Benachrichtigungskanal
und ermöglicht automatische Wiederholungsversuche ohne Auswirkung auf den User.

**Warum `europe-west1` für API Gateway?**
GCP API Gateway unterstützt `europe-west3` (Frankfurt) nicht als Gateway-Deployment-Region.
Der App Engine Backend-Service bleibt in `europe-west3`. Das Gateway ist nur ein
vorgelagerter Proxy — die zusätzliche Latenz durch die andere Region ist vernachlässigbar.
