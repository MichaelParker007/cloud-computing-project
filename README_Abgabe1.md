# Cloud Computing Projekt

### Das Thema:

**Versicherungen HUB**

### Beschreibung:

Hub für Verwaltung von unterschiedlichen Versicherungen wie: Lebens-, Auto-, Zähne-, usw. Versicherungen.

*Man kann es wie IDEALO vorstellen. Ein Benutzer hat einen Account, wo er unterschiedliche bereits vorhandene Versicherungen aus dem aktuellem Markt:*

- **ansieht**
- **hinzufügt**
- **löscht**
- **vergleicht**
- **anmeldet/unterschreibt**

### Ziel:

- Verbesserte Übersicht über die Verträge
- Zeitersparnis (für den Berater)
- Kostenersparnis (bessere Abos für Kunden)
- 24/7 Support (KI Assistent mir Voice Auswahl + Sprach Auswahl)

### Inhalte des Systems:

- Benutzer anlegen (Registrieren und Anmelden mit Google Account)
- Benutzerdaten löschen
- Verwaltung von Benutzerdaten
- Verwaltung von Versicherungen (**ansehen, hinzufügen, löschen, vergleichen, anmelden/unterschreiben**)
- Formulare herunterladen / digital unterschreiben mit Verifizierung / hochladen
- Abrufen vom Formular Status (Beantragt, In Bearbeitung, Abgelehnt, Genehmigt)
- (optional) 24/7 Support - Popup / Seite (KI Assistent mir Voice Auswahl + Sprach Auswahl)

---

# IaaS – Virtual Machine (Google Compute Engine)

## Ziel

Die Anwendung sollte zuerst klassisch auf einer Virtual Machine betrieben werden.

Dabei wurden Frontend und Backend manuell auf einer Linux-VM installiert und gestartet.

Verwendete Technologien:

- Angular Frontend
    
- Python FastAPI Backend
    
- Firestore Datenbank
    
- Google Compute Engine VM
    

---

## Architektur

```text
Firestore
   ↓
FastAPI Backend
   ↓
Angular Frontend
   ↓
Browser
```

---

## Projekt aus GitHub clonen auf VM

Damit GitHub Projekt auf VM funktioniert muss man:

• auf VM git installieren:

```bash
sudo apt update
sudo apt install git -y
```

• Projekt von GitHub holen:

```bash
git clone https://github.com/MichaelParker007/cloud-computing-project.git
cd cloud-computing-project
```

• Backend (Shell Fenster 1):

```bash
pip install fastapi uvicorn
python -m uvicorn main:app --host 0.0.0.0 --port 5000
```

• Frontend (Shell Fenster 2):

```bash
cd ~/cloud-computing-project/frontend
npm install
ng serve --host 0.0.0.0 --port 4200
```

---

## Firestore

Firestore  
im Backend:

• pip install google-cloud-firestore

• IAM und Verwaltung -> Dienstkonten -> „Dienstkonto erstellen“ -> Name: firestore-access -> Als Rolle: Cloud Datastore User

• Firestore API aktiviert

• Backend-Code anpassen

Backend:

```bash
cd ~/cloud-computing-project/backend
source venv/bin/activate
pip install google-cloud-firestore
python3 -m uvicorn main:app --host 0.0.0.0 --port 5000
```

Frontend:

```bash
cd ~/cloud-computing-project/frontend
npm install
ng serve --host 0.0.0.0 --port 4200
```

Im Browser:

```text
http://34.159.210.74:4200
```

Zusammenfassung, warum Firestore als eine Datenbank gewählt wurde:

Firestore gewählt, weil:

• NoSQL → passt zu JSON-Struktur der Daten

• Serverless → kein Setup, keine Wartung

• Skalierbar → wächst automatisch mit Nutzung

• Einfach → direkte Integration in Python/FastAPI

• Kosten → nur zahlen bei Nutzung

---

## Ergebnis von IaaS

Die gesamte Anwendung lief direkt auf der VM.

Dabei mussten:

- Linux verwaltet werden
    
- Ports freigegeben werden  
  (bei Google Cloud Netzwerke musste ein expliziter Firewall Zugang über die Ports 4200 und 5000 freigegeben werden)
    
- Prozesse manuell gestartet werden
    
- GitHub Repository geklont werden
    
- Python und Node.js installiert werden
    

Die VM stellte die komplette Infrastruktur bereit.

---

# PaaS – Google App Engine

## Ziel

Nach der IaaS Umsetzung wurde dieselbe Anwendung als PaaS deployt.

Dabei übernimmt Google:

- Deployment
    
- Skalierung
    
- Infrastruktur
    
- Runtime
    
- Verfügbarkeit
    

Es war kein manuelles Starten von Prozessen mehr notwendig. Alles sieht man im Dashboard von App Engine.

---

## Backend Deployment

Im Backend wurde eine `app.yaml` erstellt:

```yaml
runtime: python311

entrypoint: gunicorn -w 1 -k uvicorn.workers.UvicornWorker main:app
```

Zusätzlich wurde eine `requirements.txt` verwendet:

```text
fastapi
uvicorn
google-cloud-firestore
gunicorn
```

Deployment:

```bash
gcloud app deploy
```

Backend URL:

```text
https://project-64e4ee95-be58-4dea-8c0.ey.r.appspot.com
```

API:

```text
https://project-64e4ee95-be58-4dea-8c0.ey.r.appspot.com/versicherungen
```

---

## Frontend Deployment

Das Angular Frontend wurde zuerst gebaut:

```bash
npm run build
```

Danach wurde ein eigener App Engine Service erstellt.

Frontend `app.yaml`:

```yaml
runtime: python311

service: frontend
```

Deployment:

```bash
gcloud app deploy
```

Frontend URL:

```text
https://frontend-dot-project-64e4ee95-be58-4dea-8c0.ey.r.appspot.com
```

# Einstellung von Kubernetes Engine

## 1. Docker-Container erstellt

Im Backend wurde zuerst ein Docker-Image gebaut:

```bash
docker build -t versicherung-backend .
```

Dadurch wurde die FastAPI-Anwendung containerisiert.

---

## 2. Image in Artifact Registry hochgeladen

Docker-Image taggen:

```bash
docker tag versicherung-backend \
europe-west3-docker.pkg.dev/project-64e4ee95-be58-4dea-8c0/versicherung-repo/versicherung-backend:latest
```

Image hochladen:

```bash
docker push \
europe-west3-docker.pkg.dev/project-64e4ee95-be58-4dea-8c0/versicherung-repo/versicherung-backend:latest
```

---

## 3. Kubernetes Cluster verwendet

Ein bestehender Autopilot-Cluster wurde genutzt:

```text
autopilot-cluster-2
```

Cluster-Zugriff:

```bash
gcloud container clusters get-credentials autopilot-cluster-2 \
--region=europe-west3
```

---

## 4. Deployment erstellt

Backend-Deployment:

```bash
kubectl create deployment versicherung-backend \
--image=europe-west3-docker.pkg.dev/project-64e4ee95-be58-4dea-8c0/versicherung-repo/versicherung-backend:latest
```

---

## 5. LoadBalancer erstellt

Service öffentlich erreichbar gemacht:

```bash
kubectl expose deployment versicherung-backend \
--type=LoadBalancer \
--port=80 \
--target-port=5000
```

Dadurch wurde eine externe IP erzeugt.

---

## 6. Firestore-Berechtigungen konfiguriert

Für den Zugriff auf Firestore wurde:

- ein Google Service Account erstellt
    
- die Rolle `Cloud Datastore User` vergeben
    
- Workload Identity konfiguriert
    

Kubernetes Service Account:

```bash
kubectl create serviceaccount firestore-ksa
```

Deployment mit Service Account verbunden:

```bash
kubectl patch deployment versicherung-backend \
-p '{"spec":{"template":{"spec":{"serviceAccountName":"firestore-ksa"}}}}'
```

---

## 7. Firestore im Backend konfiguriert

```python
db = firestore.Client(
    project="project-64e4ee95-be58-4dea-8c0",
    database="versicherung-db"
)
```

---

# Ergebnis

Die Anwendung läuft erfolgreich in Google Kubernetes Engine.

API erreichbar unter:

```text
http://34.159.91.7/versicherungen
```

Antwort:

```json
[
  {
    "id": 1,
    "typ": "Autoversicherung",
    "anbieter": "Allianz",
    "preis": 89.99
  }
]
```


# Cloud Run Deployment

## Ziel

Deployment des FastAPI-Backends als Docker-Container auf Google Cloud Run.

---

# Deployment

Auf der Google Compute Engine VM wurde folgender Befehl ausgeführt:

```bash
gcloud run deploy versicherung-backend-run \
--image=gcr.io/project-64e4ee95-be58-4dea-8c0/versicherung-backend \
--region=europe-west3 \
--platform=managed \
--allow-unauthenticated \
--port=5000 \
--set-env-vars=GOOGLE_CLOUD_PROJECT=project-64e4ee95-be58-4dea-8c0
```

---

# IAM Berechtigungen

Dem Service Account

```text
348933755247-compute@developer.gserviceaccount.com
```

wurde die Rolle

```text
Cloud Datastore User
```

zugewiesen, damit Cloud Run auf Firestore zugreifen kann.

---

# Service URL

Nach erfolgreichem Deployment wurde folgende URL erstellt:

```text
https://versicherung-backend-run-348933755247.europe-west3.run.app
```

---

# API Test

Der Endpoint

```text
/versicherungen
```

liefert erfolgreich die Versicherungsdaten aus Firestore zurück.

---

# Eigenschaften von Cloud Run

- serverloses Deployment
- automatische Skalierung
- Docker-Unterstützung
- HTTPS standardmäßig aktiviert
- keine Serververwaltung notwendig

---

# Cloud Functions Deployment

## Ziel

Erstellung einer serverlosen Funktion mit Google Cloud Functions.

---

# Projektstruktur

## main.py (ausführen mit nano)

```python
def hello_http(request):
    return "Unsere erste serverlose Funktion für die Abgabe 1"
```

## requirements.txt (ausführen mit nano)

```text
functions-framework
```

---

# Deployment

Die Funktion wurde auf der VM mit folgendem Befehl deployt:

```bash
gcloud functions deploy hello_http \
--runtime python311 \
--trigger-http \
--allow-unauthenticated \
--region europe-west3
```

---

# IAM Berechtigungen

Dem Service Account

```text
348933755247-compute@developer.gserviceaccount.com
```

wurde die Rolle

```text
roles/cloudbuild.builds.builder
```

zugewiesen.

---

# Funktions-URL

Nach erfolgreichem Deployment wurde folgende URL erstellt:

```text
https://europe-west3-project-64e4ee95-be58-4dea-8c0.cloudfunctions.net/hello_http
```

---

# Test

Die Funktion wurde erfolgreich im Browser getestet.

## Ausgabe

```text
Unsere erste serverlose Funktion für die Abgabe 1
```
