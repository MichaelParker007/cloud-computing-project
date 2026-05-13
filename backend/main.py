import mimetypes
import os
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Depends, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from google.cloud import firestore, storage


load_dotenv()

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
FIRESTORE_PROJECT_ID = os.getenv("FIRESTORE_PROJECT_ID", "project-64e4ee95-be58-4dea-8c0")
FIRESTORE_DATABASE = os.getenv("FIRESTORE_DATABASE", "versicherung-db")
FRONTEND_BUCKET = os.getenv("FRONTEND_BUCKET", "versicherung-frontend-storage")

app = FastAPI(title="Versicherungen HUB API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:4200",
        "http://127.0.0.1:4200",
        "http://34.159.210.74:4200",
        "https://project-64e4ee95-be58-4dea-8c0.ey.r.appspot.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

db = firestore.Client(
    project=FIRESTORE_PROJECT_ID,
    database=FIRESTORE_DATABASE,
)

storage_client = storage.Client(project=FIRESTORE_PROJECT_ID)
bucket = storage_client.bucket(FRONTEND_BUCKET)


class GoogleLoginRequest(BaseModel):
    credential: str


class User(BaseModel):
    google_id: str
    name: str
    email: str
    picture: Optional[str] = None


class Insurance(BaseModel):
    doc_id: str
    id: int
    name: str
    category: str
    provider: str
    monthly_price: float
    description: str


def verify_google_token(credential: str) -> User:
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=500,
            detail="GOOGLE_CLIENT_ID ist im Backend nicht konfiguriert.",
        )

    try:
        id_info = id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            GOOGLE_CLIENT_ID,
            clock_skew_in_seconds=60,
        )

        issuer = id_info.get("iss")
        if issuer not in ["accounts.google.com", "https://accounts.google.com"]:
            raise ValueError("Ungültiger Token-Aussteller.")

        return User(
            google_id=id_info["sub"],
            name=id_info.get("name", ""),
            email=id_info.get("email", ""),
            picture=id_info.get("picture"),
        )

    except ValueError as error:
        raise HTTPException(
            status_code=401,
            detail=f"Ungültiger Google Token: {str(error)}",
        )


def get_current_user(authorization: Optional[str] = Header(default=None)) -> User:
    if not authorization:
        raise HTTPException(
            status_code=401,
            detail="Authorization Header fehlt.",
        )

    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Authorization Header muss mit Bearer beginnen.",
        )

    credential = authorization.replace("Bearer ", "")
    return verify_google_token(credential)


def load_versicherungen_from_firestore() -> list[dict]:
    docs = db.collection("versicherungen").stream()

    versicherungen = []

    for doc in docs:
        data = doc.to_dict()

        versicherungen.append({
            "doc_id": doc.id,
            "id": int(data.get("id", 0)),
            "name": f"{data.get('typ', '')} von {data.get('anbieter', '')}",
            "category": data.get("typ", ""),
            "provider": data.get("anbieter", ""),
            "monthly_price": float(data.get("preis", 0)),
            "description": data.get("beschreibung", "Beschreibung folgt später."),
        })

    return versicherungen


@app.get("/")
def root():
    return serve_frontend("")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/health")
def api_health():
    return {"status": "Backend läuft"}


@app.get("/api/config")
def get_config():
    return {
        "appName": "Versicherungs-Hub",
        "apiBaseUrl": "/api",
    }


@app.post("/auth/google", response_model=User)
def login_with_google(request: GoogleLoginRequest):
    return verify_google_token(request.credential)


@app.post("/api/auth/google", response_model=User)
def api_login_with_google(request: GoogleLoginRequest):
    return verify_google_token(request.credential)


@app.get("/me", response_model=User)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@app.get("/api/me", response_model=User)
def api_get_me(current_user: User = Depends(get_current_user)):
    return current_user


@app.get("/versicherungen", response_model=list[Insurance])
def get_versicherungen(current_user: User = Depends(get_current_user)):
    return load_versicherungen_from_firestore()


@app.get("/api/versicherungen", response_model=list[Insurance])
def api_get_versicherungen(current_user: User = Depends(get_current_user)):
    return load_versicherungen_from_firestore()


@app.get("/insurances", response_model=list[Insurance])
def get_insurances(current_user: User = Depends(get_current_user)):
    return load_versicherungen_from_firestore()


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
