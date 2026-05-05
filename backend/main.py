from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import firestore

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Firestore verbinden
db = firestore.Client()

@app.get("/")
def root():
    return {"status": "Versicherung-Hub API läuft"}

@app.get("/versicherungen")
def get_versicherungen():
    docs = db.collection("versicherungen").stream()

    versicherungen = []
    for doc in docs:
        data = doc.to_dict()
        data["doc_id"] = doc.id
        versicherungen.append(data)

    return versicherungen
