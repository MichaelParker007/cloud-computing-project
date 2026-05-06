from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import firestore

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://34.159.210.74:4200"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

db = firestore.Client(database="versicherung-db")

@app.get("/")
def root():
    return {"status": "Versicherung-Hub API läuft"}

@app.get("/versicherungen")
def get_versicherungen():
    docs = db.collection("versicherungen").stream()
    return [doc.to_dict() | {"doc_id": doc.id} for doc in docs]
