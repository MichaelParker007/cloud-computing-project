from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import firestore, storage
import mimetypes
import os

PROJECT_ID = "project-64e4ee95-be58-4dea-8c0"
FIRESTORE_DATABASE = "versicherung-db"
FRONTEND_BUCKET = "versicherung-frontend-storage"

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

db = firestore.Client(
    project=PROJECT_ID,
    database=FIRESTORE_DATABASE
)

storage_client = storage.Client(project=PROJECT_ID)
bucket = storage_client.bucket(FRONTEND_BUCKET)


@app.get("/api/health")
def health():
    return {"status": "Backend läuft"}


@app.get("/api/config")
def get_config():
    return {
        "appName": "Versicherungs-Hub",
        "apiBaseUrl": "/api"
    }


@app.get("/api/versicherungen")
def get_versicherungen():
    docs = db.collection("versicherungen").stream()
    return [doc.to_dict() | {"doc_id": doc.id} for doc in docs]


@app.get("/{file_path:path}")
def serve_frontend(file_path: str):
    if file_path == "":
        file_path = "index.html"

    blob = bucket.blob(file_path)

    if not blob.exists():
        blob = bucket.blob("index.html")
        file_path = "index.html"

    content = blob.download_as_bytes()
    content_type = mimetypes.guess_type(file_path)[0] or "application/octet-stream"

    return Response(content=content, media_type=content_type)
