# README – Teilabgabe 2: Persistence

Houssam Sakah (hosakahx) 
Pawel Gorka (pagorkax) 
Mykhailo Fakliier (myfaklii) 
Link auf das GitHub Repo: https://github.com/MichaelParker007/cloud-computing-project.git README_Abgabe2.md ist in GitHub Repo als Datei.
Hier ist auch die Doku ebenfalls in der Abgabedatei.

## Gesamtarchitektur

Die Anwendung besteht aus einer gemeinsamen Cloud-Architektur mit drei Persistenzmechanismen.

```text
Browser
   |
Angular Frontend
   |
FastAPI Backend (Google App Engine)
   |-- Cloud SQL (relationale Benutzerdaten)
   |-- Firestore (dokumentenbasierte Anwendungsdaten)
   \-- Cloud Storage (objektbasierte Dateien / Frontend-Artefakte)
```

Architekturentscheidung:

* Cloud SQL für strukturierte Benutzerdaten
* Firestore für flexible fachliche Anwendungsdaten
* Cloud Storage für statische Dateien und Objekte

## Verwendete Google Cloud-Dienste

### Google App Engine

Bereitstellung des FastAPI-Backends.

### Google Cloud SQL

Relationale MySQL-Datenbank für Benutzerverwaltung.

### Google Firestore

Dokumentenorientierte Persistenz für flexible Anwendungsdaten.
Collections:

* versicherungen
* packages
* folders
* files

### Google Cloud Storage

Objektbasierter Speicher.
Bucket:

* versicherung-frontend-storage

### Google OAuth

Authentifizierung für Benutzeranmeldung.


## Deployment-Schritte

### Frontend

```bash
cd frontend
npm install
npm run build
gcloud storage cp -r dist/frontend/browser/* gs://versicherung-frontend-storage/
```

### Backend

```bash
cd backend
gcloud app deploy
gcloud app browse
```

## Datenmodellierung

### Cloud SQL

```sql
users
-----
id              INT PRIMARY KEY AUTO_INCREMENT
google_sub      VARCHAR(255) UNIQUE NULL
email           VARCHAR(255) UNIQUE NOT NULL
name            VARCHAR(255)
picture         VARCHAR(1024)
password_hash   VARCHAR(512) NULL
auth_provider   VARCHAR(50)
role            VARCHAR(50)
created_at      DATETIME
last_login      DATETIME
```

Begründung:
Strukturierte konsistente Benutzerdaten.

### Firestore

Collections:

* versicherungen
* packages
* folders
* files

Beispiel:

```json
{
  "name": "Private Krankenversicherung",
  "anbieter": "Muster Versicherung AG",
  "monatspreis": 299.99
}
```

Begründung:
Flexible dokumentenbasierte Daten.

### Cloud Storage

Objektstruktur:

```text
index.html
main-xxxxx.js
polyfills-xxxxx.js
styles-xxxxx.css
assets/
```

Begründung:
Statische Build-Artefakte und Objekte.

## Technische Reflexion

| Kriterium         | Cloud SQL          | Firestore            | Cloud Storage        |
| ----------------- | ------------------ | -------------------- | -------------------- |
| Datenmodell       | relational         | dokumentenorientiert | objektbasiert        |
| Zugriffsverhalten | SQL-Abfragen       | dokumentzentriert    | Datei-/Objektzugriff |
| Konsistenz        | hoch               | dokumentbasiert      | objektbasiert        |
| Skalierbarkeit    | managed            | hoch horizontal      | sehr hoch            |
| Betriebsaufwand   | mittel             | gering               | gering               |
| Einsatzszenario   | Benutzerverwaltung | Fachdaten            | Datei                |
