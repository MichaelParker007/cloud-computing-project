from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# auf die API zugreifen
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Testdaten – später durch echte Datenbank ersetzen
versicherungen = [
    {"id": 1, "typ": "Autoversicherung", "anbieter": "Allianz", "preis": 89.99},
    {"id": 2, "typ": "Lebensversicherung", "anbieter": "AXA", "preis": 120.00},
    {"id": 3, "typ": "Zahnversicherung", "anbieter": "DKV", "preis": 35.50},
]

@app.get("/")
def root():
    return {"status": "Versicherung-Hub API läuft"}

@app.get("/versicherungen")
def get_versicherungen():
    return versicherungen
    