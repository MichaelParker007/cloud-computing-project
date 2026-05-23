import mimetypes
import os
import uuid
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, List

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Depends, Response, UploadFile, File, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr

from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from google.cloud import firestore, storage

import jwt
from sqlalchemy.orm import Session
from database import engine
from models import Base, User as SQLUser

load_dotenv()

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
FIRESTORE_PROJECT_ID = os.getenv("FIRESTORE_PROJECT_ID", "project-64e4ee95-be58-4dea-8c0")
FIRESTORE_DATABASE = os.getenv("FIRESTORE_DATABASE", "versicherung-db")
FRONTEND_BUCKET = os.getenv("FRONTEND_BUCKET", "versicherung-frontend-storage")
FILE_UPLOAD_BUCKET = os.getenv("FILE_UPLOAD_BUCKET", "versicherung-file-uploads")
JWT_SECRET = os.getenv("JWT_SECRET", secrets.token_hex(32))
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

app = FastAPI(title="Versicherungen HUB API")
Base.metadata.create_all(bind=engine)

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

try:
    upload_bucket = storage_client.bucket(FILE_UPLOAD_BUCKET)
except Exception:
    upload_bucket = None


# ── Models ───────────────────────────────────────────────────────────────

class GoogleLoginRequest(BaseModel):
    credential: str


class EmailRegisterRequest(BaseModel):
    email: str
    password: str
    name: str


class EmailLoginRequest(BaseModel):
    email: str
    password: str


class User(BaseModel):
    user_id: str
    name: str
    email: str
    role: str = "kunde"
    picture: Optional[str] = None
    auth_provider: str = "google"


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    email: Optional[str] = None


class Insurance(BaseModel):
    doc_id: str
    id: int
    name: str
    category: str
    provider: str
    monthly_price: float
    description: str


class FolderCreate(BaseModel):
    name: str
    parent_id: Optional[str] = None
    versicherung_id: Optional[str] = None


class FolderResponse(BaseModel):
    folder_id: str
    name: str
    parent_id: Optional[str] = None
    versicherung_id: Optional[str] = None
    owner_id: str
    created_at: str


class FileResponse(BaseModel):
    file_id: str
    name: str
    folder_id: str
    size: int
    content_type: str
    uploaded_by: str
    created_at: str
    download_url: Optional[str] = None


class PackageResponse(BaseModel):
    package_id: str
    name: str
    description: str
    leistungen: List[str]
    price: float
    tier: str


class AssignClientRequest(BaseModel):
    client_email: str


# ── Password Hashing ────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100000)
    return f"{salt}:{hashed.hex()}"


def verify_password(password: str, stored: str) -> bool:
    salt, hashed = stored.split(":")
    check = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100000)
    return check.hex() == hashed


# ── JWT ──────────────────────────────────────────────────────────────────

def create_jwt_token(user_data: dict) -> str:
    payload = {
        **user_data,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_jwt_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token abgelaufen.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Ungültiger Token.")


# ── Google Token Verification ────────────────────────────────────────────

def verify_google_token(credential: str) -> dict:
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
        return {
            "google_id": id_info["sub"],
            "name": id_info.get("name", ""),
            "email": id_info.get("email", ""),
            "picture": id_info.get("picture"),
        }
    except ValueError as error:
        raise HTTPException(
            status_code=401,
            detail=f"Ungültiger Google Token: {str(error)}",
        )


# ── User Lookup / Creation in Firestore ──────────────────────────────────

def get_or_create_user_from_google(google_info: dict) -> User:
    with Session(engine) as sql_db:
        sql_user = (
            sql_db.query(SQLUser)
            .filter(SQLUser.email == google_info["email"])
            .first()
        )

        if not sql_user:
            sql_user = SQLUser(
                google_sub=google_info["google_id"],
                email=google_info["email"],
                name=google_info["name"],
                picture=google_info.get("picture"),
                auth_provider="google",
                role="kunde",
            )
            sql_db.add(sql_user)
        else:
            sql_user.google_sub = sql_user.google_sub or google_info["google_id"]
            sql_user.name = sql_user.name or google_info["name"]
            sql_user.picture = sql_user.picture or google_info.get("picture")
            sql_user.auth_provider = sql_user.auth_provider or "google"

        sql_user.last_login = datetime.utcnow()
        sql_db.commit()
        sql_db.refresh(sql_user)

        return User(
            user_id=str(sql_user.id),
            name=sql_user.name or "",
            email=sql_user.email,
            role=sql_user.role or "kunde",
            picture=sql_user.picture,
            auth_provider=sql_user.auth_provider or "google",
        )


# ── Auth Dependency ──────────────────────────────────────────────────────

def get_current_user(authorization: Optional[str] = Header(default=None)) -> User:
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization Header fehlt.")

    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization Header muss mit Bearer beginnen.")

    token = authorization.replace("Bearer ", "")

    # Try JWT first
    try:
        payload = decode_jwt_token(token)
        return User(
            user_id=payload["user_id"],
            name=payload["name"],
            email=payload["email"],
            role=payload.get("role", "kunde"),
            picture=payload.get("picture"),
            auth_provider=payload.get("auth_provider", "email"),
        )
    except HTTPException:
        pass

    # Fall back to Google token
    google_info = verify_google_token(token)
    user = get_or_create_user_from_google(google_info)
    return user


def require_role(*roles):
    def dependency(current_user: User = Depends(get_current_user)):
        if current_user.role not in roles:
            raise HTTPException(
                status_code=403,
                detail=f"Zugriff verweigert. Erforderliche Rolle: {', '.join(roles)}",
            )
        return current_user
    return dependency


# ── Firestore Helpers ────────────────────────────────────────────────────

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


# ══════════════════════════════════════════════════════════════════════════
# ROUTES
# ══════════════════════════════════════════════════════════════════════════

# ── Health ───────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/health")
def api_health():
    return {"status": "Backend läuft"}


@app.get("/api/config")
def get_config():
    return {"appName": "Versicherungs-Hub", "apiBaseUrl": "/api"}


# ── Auth: Google ─────────────────────────────────────────────────────────

@app.post("/api/auth/google")
def api_login_with_google(request: GoogleLoginRequest):
    google_info = verify_google_token(request.credential)
    user = get_or_create_user_from_google(google_info)
    token = create_jwt_token({
        "user_id": user.user_id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "picture": user.picture,
        "auth_provider": "google",
    })
    return {"token": token, "user": user.model_dump()}


@app.post("/auth/google")
def login_with_google(request: GoogleLoginRequest):
    return api_login_with_google(request)


# ── Auth: Email ──────────────────────────────────────────────────────────

@app.post("/api/auth/register")
def register_with_email(request: EmailRegisterRequest):
    with Session(engine) as sql_db:
        existing = (
            sql_db.query(SQLUser)
            .filter(SQLUser.email == request.email)
            .first()
        )

        if existing:
            raise HTTPException(
                status_code=409,
                detail="Ein Benutzer mit dieser E-Mail existiert bereits.",
            )

        sql_user = SQLUser(
            email=request.email,
            name=request.name,
            role="kunde",
            password_hash=hash_password(request.password),
            auth_provider="email",
            picture=None,
        )

        sql_db.add(sql_user)
        sql_db.commit()
        sql_db.refresh(sql_user)

        token = create_jwt_token({
            "user_id": str(sql_user.id),
            "name": sql_user.name,
            "email": sql_user.email,
            "role": sql_user.role,
            "picture": sql_user.picture,
            "auth_provider": sql_user.auth_provider,
        })

        return {
            "token": token,
            "user": {
                "user_id": str(sql_user.id),
                "name": sql_user.name,
                "email": sql_user.email,
                "role": sql_user.role,
                "picture": sql_user.picture,
                "auth_provider": sql_user.auth_provider,
            },
        }

@app.post("/api/auth/login")
def login_with_email(request: EmailLoginRequest):
    with Session(engine) as sql_db:
        sql_user = (
            sql_db.query(SQLUser)
            .filter(SQLUser.email == request.email)
            .first()
        )

        if not sql_user:
            raise HTTPException(status_code=401, detail="E-Mail oder Passwort falsch.")

        if not sql_user.password_hash:
            raise HTTPException(status_code=401, detail="Bitte melden Sie sich mit Google an.")

        if not verify_password(request.password, sql_user.password_hash):
            raise HTTPException(status_code=401, detail="E-Mail oder Passwort falsch.")

        sql_user.last_login = datetime.utcnow()
        sql_db.commit()
        sql_db.refresh(sql_user)

        token = create_jwt_token({
            "user_id": str(sql_user.id),
            "name": sql_user.name or "",
            "email": sql_user.email,
            "role": sql_user.role or "kunde",
            "picture": sql_user.picture,
            "auth_provider": sql_user.auth_provider or "email",
        })

        return {
            "token": token,
            "user": {
                "user_id": str(sql_user.id),
                "name": sql_user.name or "",
                "email": sql_user.email,
                "role": sql_user.role or "kunde",
                "picture": sql_user.picture,
                "auth_provider": sql_user.auth_provider or "email",
            },
        }


# ── Current User ─────────────────────────────────────────────────────────

@app.get("/api/me")
def api_get_me(current_user: User = Depends(get_current_user)):
    return current_user.model_dump()


@app.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    return current_user.model_dump()


# ── User Management (Admin) ─────────────────────────────────────────────

@app.get("/api/users")
def list_users(current_user: User = Depends(require_role("admin"))):
    with Session(engine) as sql_db:
        sql_users = sql_db.query(SQLUser).all()

        return [
            {
                "user_id": str(u.id),
                "name": u.name or "",
                "email": u.email,
                "role": u.role or "kunde",
                "picture": u.picture,
                "auth_provider": u.auth_provider or "unknown",
                "created_at": u.created_at.isoformat() if u.created_at else "",
                "last_login": u.last_login.isoformat() if u.last_login else "",
            }
            for u in sql_users
        ]


@app.get("/api/users/{user_id}")
def get_user(user_id: str, current_user: User = Depends(require_role("admin"))):
    with Session(engine) as sql_db:
        sql_user = sql_db.query(SQLUser).filter(SQLUser.id == int(user_id)).first()

        if not sql_user:
            raise HTTPException(status_code=404, detail="Benutzer nicht gefunden.")

        return {
            "user_id": str(sql_user.id),
            "name": sql_user.name or "",
            "email": sql_user.email,
            "role": sql_user.role or "kunde",
            "picture": sql_user.picture,
            "auth_provider": sql_user.auth_provider or "unknown",
            "created_at": sql_user.created_at.isoformat() if sql_user.created_at else "",
            "last_login": sql_user.last_login.isoformat() if sql_user.last_login else "",
        }

@app.put("/api/users/{user_id}")
def update_user(user_id: str, update: UserUpdate, current_user: User = Depends(require_role("admin"))):
    with Session(engine) as sql_db:
        sql_user = sql_db.query(SQLUser).filter(SQLUser.id == int(user_id)).first()

        if not sql_user:
            raise HTTPException(status_code=404, detail="Benutzer nicht gefunden.")

        update_data = {k: v for k, v in update.model_dump().items() if v is not None}

        if "role" in update_data and update_data["role"] not in ("admin", "berater", "kunde"):
            raise HTTPException(status_code=400, detail="Ungültige Rolle.")

        if "name" in update_data:
            sql_user.name = update_data["name"]
        if "email" in update_data:
            sql_user.email = update_data["email"]
        if "role" in update_data:
            sql_user.role = update_data["role"]

        sql_db.commit()

        return {"message": "Benutzer aktualisiert.", "user_id": user_id}


@app.delete("/api/users/{user_id}")
def delete_user(user_id: str, current_user: User = Depends(require_role("admin"))):
    with Session(engine) as sql_db:
        sql_user = sql_db.query(SQLUser).filter(SQLUser.id == int(user_id)).first()

        if not sql_user:
            raise HTTPException(status_code=404, detail="Benutzer nicht gefunden.")

        sql_db.delete(sql_user)
        sql_db.commit()

        return {"message": "Benutzer gelöscht.", "user_id": user_id}


# ── Berater: Client Management ──────────────────────────────────────────

@app.get("/api/berater/clients")
def get_berater_clients(current_user: User = Depends(require_role("berater", "admin"))):
    docs = db.collection("users").where("assigned_berater", "==", current_user.user_id).stream()
    clients = []
    for doc in docs:
        data = doc.to_dict()
        clients.append({
            "user_id": doc.id,
            "name": data.get("name", ""),
            "email": data.get("email", ""),
            "role": data.get("role", "kunde"),
        })
    return clients


@app.post("/api/berater/clients")
def assign_client(req: AssignClientRequest, current_user: User = Depends(require_role("berater", "admin"))):
    docs = list(db.collection("users").where("email", "==", req.client_email).limit(1).stream())
    if not docs:
        raise HTTPException(status_code=404, detail="Kunde nicht gefunden.")
    doc = docs[0]
    db.collection("users").document(doc.id).update({"assigned_berater": current_user.user_id})
    return {"message": "Kunde zugewiesen.", "client_id": doc.id}


# ── Versicherungen ──────────────────────────────────────────────────────

@app.get("/api/versicherungen", response_model=list[Insurance])
def api_get_versicherungen(current_user: User = Depends(get_current_user)):
    return load_versicherungen_from_firestore()

@app.get("/api/versicherungen/{doc_id}", response_model=Insurance)
def api_get_versicherung_detail(
    doc_id: str,
    current_user: User = Depends(get_current_user),
):
    doc = db.collection("versicherungen").document(doc_id).get()

    if not doc.exists:
        raise HTTPException(status_code=404, detail="Versicherung nicht gefunden.")

    data = doc.to_dict()

    return {
        "doc_id": doc.id,
        "id": int(data.get("id", 0)),
        "name": f"{data.get('typ', '')} von {data.get('anbieter', '')}",
        "category": data.get("typ", ""),
        "provider": data.get("anbieter", ""),
        "monthly_price": float(data.get("preis", 0)),
        "description": data.get("beschreibung", "Beschreibung folgt später."),
    }


@app.get("/versicherungen", response_model=list[Insurance])
def get_versicherungen(current_user: User = Depends(get_current_user)):
    return load_versicherungen_from_firestore()


# ── Form Submissions ─────────────────────────────────────────────────────

class FormSubmissionSave(BaseModel):
    form_data: dict
    signature_data: Optional[str] = None


@app.get("/api/versicherungen/{doc_id}/formulare")
def get_form_submissions(doc_id: str, current_user: User = Depends(get_current_user)):
    query = db.collection("form_submissions").where("versicherung_id", "==", doc_id)
    if current_user.role == "kunde":
        query = query.where("user_id", "==", current_user.user_id)
    docs = query.stream()
    result = []
    for doc in docs:
        data = doc.to_dict()
        result.append({
            "form_id": doc.id,
            "versicherung_id": data.get("versicherung_id", ""),
            "user_id": data.get("user_id", ""),
            "user_name": data.get("user_name", ""),
            "user_email": data.get("user_email", ""),
            "status": data.get("status", "offen"),
            "submitted_at": data.get("submitted_at", ""),
            "created_at": data.get("created_at", ""),
        })
    return result


@app.post("/api/versicherungen/{doc_id}/formulare/save")
def save_form_submission(
    doc_id: str,
    body: FormSubmissionSave,
    current_user: User = Depends(get_current_user),
):
    existing = list(
        db.collection("form_submissions")
        .where("versicherung_id", "==", doc_id)
        .where("user_id", "==", current_user.user_id)
        .limit(1)
        .stream()
    )
    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "versicherung_id": doc_id,
        "user_id": current_user.user_id,
        "user_name": current_user.name,
        "user_email": current_user.email,
        "form_data": body.form_data,
        "signature_data": body.signature_data,
        "updated_at": now,
    }
    if existing:
        form_id = existing[0].id
        existing_status = existing[0].to_dict().get("status", "offen")
        if existing_status not in ("abgeschickt", "bearbeitet"):
            payload["status"] = "offen"
        db.collection("form_submissions").document(form_id).update(payload)
        return {"message": "Formular gespeichert.", "form_id": form_id, "status": existing_status}
    else:
        form_id = str(uuid.uuid4())
        payload["status"] = "offen"
        payload["created_at"] = now
        db.collection("form_submissions").document(form_id).set(payload)
        return {"message": "Formular gespeichert.", "form_id": form_id, "status": "offen"}


@app.post("/api/versicherungen/{doc_id}/formulare/{form_id}/submit")
def submit_form_submission(
    doc_id: str,
    form_id: str,
    current_user: User = Depends(get_current_user),
):
    doc_ref = db.collection("form_submissions").document(form_id)
    doc = doc_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Formular nicht gefunden.")
    data = doc.to_dict()
    if data.get("user_id") != current_user.user_id and current_user.role not in ("admin", "berater"):
        raise HTTPException(status_code=403, detail="Zugriff verweigert.")
    now = datetime.now(timezone.utc).isoformat()
    doc_ref.update({"status": "abgeschickt", "submitted_at": now})
    return {"message": "Formular abgeschickt.", "status": "abgeschickt"}


@app.get("/api/versicherungen/{doc_id}/formulare/{form_id}")
def get_form_submission_detail(
    doc_id: str,
    form_id: str,
    current_user: User = Depends(get_current_user),
):
    doc_ref = db.collection("form_submissions").document(form_id)
    doc = doc_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Formular nicht gefunden.")
    data = doc.to_dict()
    # Berater/Admin viewing a submitted form → auto-change status to "bearbeitet"
    if current_user.role in ("berater", "admin") and data.get("status") == "abgeschickt":
        now = datetime.now(timezone.utc).isoformat()
        doc_ref.update({"status": "bearbeitet", "viewed_by": current_user.user_id, "viewed_at": now})
        data["status"] = "bearbeitet"
    return {
        "form_id": doc.id,
        "versicherung_id": data.get("versicherung_id", ""),
        "user_id": data.get("user_id", ""),
        "user_name": data.get("user_name", ""),
        "user_email": data.get("user_email", ""),
        "form_data": data.get("form_data", {}),
        "signature_data": data.get("signature_data"),
        "status": data.get("status", "offen"),
        "submitted_at": data.get("submitted_at", ""),
        "created_at": data.get("created_at", ""),
    }


@app.get("/insurances", response_model=list[Insurance])
def get_insurances(current_user: User = Depends(get_current_user)):
    return load_versicherungen_from_firestore()


# ── Packages (Pakete) ───────────────────────────────────────────────────

@app.get("/api/packages")
def get_packages(current_user: User = Depends(get_current_user)):
    docs = db.collection("packages").stream()
    packages = []
    for doc in docs:
        data = doc.to_dict()
        packages.append({
            "package_id": doc.id,
            "name": data.get("name", ""),
            "description": data.get("description", ""),
            "leistungen": data.get("leistungen", []),
            "price": float(data.get("price", 0)),
            "tier": data.get("tier", "basic"),
        })

    if not packages:
        packages = [
            {
                "package_id": "basic",
                "name": "Basic-Paket",
                "description": "Grundlegende Versicherungsberatung und Verwaltung Ihrer Verträge.",
                "leistungen": [
                    "Versicherungsübersicht",
                    "Dokumentenverwaltung",
                    "E-Mail Support",
                ],
                "price": 0,
                "tier": "basic",
            },
            {
                "package_id": "komfort",
                "name": "Komfort-Paket",
                "description": "Erweiterte Beratung mit persönlichem Ansprechpartner.",
                "leistungen": [
                    "Alles aus Basic",
                    "Persönlicher Berater",
                    "Vertragsoptimierung",
                    "Telefon Support",
                    "Jährlicher Check-up",
                ],
                "price": 9.99,
                "tier": "komfort",
            },
            {
                "package_id": "premium",
                "name": "Premium-Paket",
                "description": "Rundum-Sorglos-Paket mit VIP-Betreuung.",
                "leistungen": [
                    "Alles aus Komfort",
                    "VIP-Betreuung",
                    "Schadensabwicklung",
                    "24/7 Hotline",
                    "Quartals-Review",
                    "Exklusive Tarife",
                ],
                "price": 24.99,
                "tier": "premium",
            },
        ]
    return packages


@app.post("/api/packages")
def create_package(
    name: str = Form(...),
    description: str = Form(""),
    leistungen: str = Form(""),
    price: float = Form(0),
    tier: str = Form("basic"),
    current_user: User = Depends(require_role("admin", "berater")),
):
    package_id = str(uuid.uuid4())
    leistungen_list = [l.strip() for l in leistungen.split(",") if l.strip()]
    data = {
        "name": name,
        "description": description,
        "leistungen": leistungen_list,
        "price": price,
        "tier": tier,
        "created_by": current_user.user_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    db.collection("packages").document(package_id).set(data)
    return {"message": "Paket erstellt.", "package_id": package_id}


# ── Vorschläge (Proposals) ──────────────────────────────────────────────

class VorschlagCreate(BaseModel):
    versicherung_id: str
    kunde_email: str
    message: Optional[str] = ""


class VorschlagAnnehmen(BaseModel):
    form_data: dict
    signature_data: Optional[str] = None


def _seed_dummy_vorschlaege(current_user: User):
    now = datetime.now(timezone.utc).isoformat()
    dummies = [
        {
            "versicherung_name": "KFZ-Versicherung von Allianz",
            "versicherung_provider": "Allianz",
            "versicherung_category": "KFZ",
            "versicherung_price": 45.90,
            "versicherung_description": "Umfassender Schutz für Ihr Fahrzeug – Haftpflicht, Teilkasko und Vollkasko in einem Paket.",
            "berater_id": "system",
            "berater_name": "Ihr Berater",
            "kunde_id": current_user.user_id,
            "kunde_email": current_user.email,
            "message": "Diese KFZ-Versicherung bietet ein hervorragendes Preis-Leistungs-Verhältnis für Ihren Fuhrpark.",
            "status": "offen",
            "created_at": now,
            "vertragslaufzeit": "12 Monate",
            "auto_verlaengerung": "Jährlich um 12 Monate",
            "mindestlaufzeit": "12 Monate",
            "kuendigungsfrist": "3 Monate zum Vertragsende",
            "abrechnungsart": "monatlich",
        },
        {
            "versicherung_name": "Hausratversicherung von AXA",
            "versicherung_provider": "AXA",
            "versicherung_category": "Hausrat",
            "versicherung_price": 12.50,
            "versicherung_description": "Schützt Ihr Hab und Gut gegen Feuer, Einbruch, Leitungswasser und Sturm.",
            "berater_id": "system",
            "berater_name": "Ihr Berater",
            "kunde_id": current_user.user_id,
            "kunde_email": current_user.email,
            "message": "Ihre aktuelle Wohnsituation spricht für diese Hausratversicherung – sehr empfehlenswert.",
            "status": "offen",
            "created_at": now,
            "vertragslaufzeit": "24 Monate",
            "auto_verlaengerung": "Jährlich um 12 Monate",
            "mindestlaufzeit": "24 Monate",
            "kuendigungsfrist": "1 Monat zum Vertragsende",
            "abrechnungsart": "jährlich",
        },
        {
            "versicherung_name": "Haftpflichtversicherung von HUK-Coburg",
            "versicherung_provider": "HUK-Coburg",
            "versicherung_category": "Haftpflicht",
            "versicherung_price": 7.80,
            "versicherung_description": "Privathaftpflicht mit bis zu 50 Mio. € Deckungssumme – der Klassiker für jeden Haushalt.",
            "berater_id": "system",
            "berater_name": "Ihr Berater",
            "kunde_id": current_user.user_id,
            "kunde_email": current_user.email,
            "message": "Eine Haftpflichtversicherung ist ein Muss – dieses Angebot ist kaum zu schlagen.",
            "status": "offen",
            "created_at": now,
            "vertragslaufzeit": "12 Monate",
            "auto_verlaengerung": "Jährlich um 12 Monate",
            "mindestlaufzeit": "12 Monate",
            "kuendigungsfrist": "3 Monate zum Vertragsende",
            "abrechnungsart": "monatlich",
        },
    ]
    for d in dummies:
        db.collection("vorschlaege").document(str(uuid.uuid4())).set(d)


@app.get("/api/vorschlaege")
def get_vorschlaege(current_user: User = Depends(get_current_user)):
    query = db.collection("vorschlaege")
    if current_user.role == "kunde":
        query = query.where("kunde_id", "==", current_user.user_id)
    elif current_user.role == "berater":
        query = query.where("berater_id", "==", current_user.user_id)

    docs = list(query.stream())

    if not docs and current_user.role == "kunde":
        _seed_dummy_vorschlaege(current_user)
        docs = list(query.stream())

    result = []
    for doc in docs:
        data = doc.to_dict()
        result.append({
            "vorschlag_id": doc.id,
            "versicherung_id": data.get("versicherung_id", ""),
            "versicherung_name": data.get("versicherung_name", ""),
            "versicherung_provider": data.get("versicherung_provider", ""),
            "versicherung_category": data.get("versicherung_category", ""),
            "versicherung_price": float(data.get("versicherung_price", 0)),
            "versicherung_description": data.get("versicherung_description", ""),
            "berater_id": data.get("berater_id", ""),
            "berater_name": data.get("berater_name", ""),
            "kunde_id": data.get("kunde_id", ""),
            "kunde_email": data.get("kunde_email", ""),
            "message": data.get("message", ""),
            "status": data.get("status", "offen"),
            "created_at": data.get("created_at", ""),
            "submitted_at": data.get("submitted_at", ""),
            "vertragsende": data.get("vertragsende", ""),
            "vertragslaufzeit": data.get("vertragslaufzeit", "12 Monate"),
            "auto_verlaengerung": data.get("auto_verlaengerung", "Jährlich um 12 Monate"),
            "mindestlaufzeit": data.get("mindestlaufzeit", "12 Monate"),
            "kuendigungsfrist": data.get("kuendigungsfrist", "3 Monate zum Vertragsende"),
            "abrechnungsart": data.get("abrechnungsart", "monatlich"),
        })
    return result


@app.post("/api/vorschlaege")
def create_vorschlag(body: VorschlagCreate, current_user: User = Depends(require_role("admin", "berater"))):
    versicherung_doc = db.collection("versicherungen").document(body.versicherung_id).get()
    if not versicherung_doc.exists:
        raise HTTPException(status_code=404, detail="Versicherung nicht gefunden.")
    v_data = versicherung_doc.to_dict()

    with Session(engine) as sql_db:
        kunde = sql_db.query(SQLUser).filter(SQLUser.email == body.kunde_email).first()
        if not kunde:
            raise HTTPException(status_code=404, detail="Kunde nicht gefunden.")
        kunde_id = str(kunde.id)

    now = datetime.now(timezone.utc).isoformat()
    vorschlag_id = str(uuid.uuid4())
    data = {
        "versicherung_id": body.versicherung_id,
        "versicherung_name": f"{v_data.get('typ', '')} von {v_data.get('anbieter', '')}",
        "versicherung_provider": v_data.get("anbieter", ""),
        "versicherung_category": v_data.get("typ", ""),
        "versicherung_price": float(v_data.get("preis", 0)),
        "versicherung_description": v_data.get("beschreibung", ""),
        "berater_id": current_user.user_id,
        "berater_name": current_user.name,
        "kunde_id": kunde_id,
        "kunde_email": body.kunde_email,
        "message": body.message or "",
        "status": "offen",
        "created_at": now,
    }
    db.collection("vorschlaege").document(vorschlag_id).set(data)
    return {"message": "Vorschlag gesendet.", "vorschlag_id": vorschlag_id}


@app.post("/api/vorschlaege/{vorschlag_id}/annehmen")
def annehmen_vorschlag(
    vorschlag_id: str,
    body: VorschlagAnnehmen,
    current_user: User = Depends(get_current_user),
):
    doc_ref = db.collection("vorschlaege").document(vorschlag_id)
    doc = doc_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Vorschlag nicht gefunden.")
    data = doc.to_dict()
    if data.get("kunde_id") != current_user.user_id:
        raise HTTPException(status_code=403, detail="Zugriff verweigert.")
    if data.get("status") != "offen":
        raise HTTPException(status_code=400, detail="Vorschlag wurde bereits bearbeitet.")

    now = datetime.now(timezone.utc)
    laufzeit = data.get("vertragslaufzeit", "12 Monate")
    monate = 12
    try:
        monate = int(laufzeit.split()[0])
    except (ValueError, IndexError):
        pass
    vertragsende = (now + timedelta(days=monate * 30)).strftime("%Y-%m-%d")
    doc_ref.update({
        "status": "angenommen",
        "form_data": body.form_data,
        "signature_data": body.signature_data,
        "submitted_at": now.isoformat(),
        "vertragsende": vertragsende,
    })
    return {"message": "Versicherung abgeschlossen.", "status": "angenommen"}


@app.post("/api/vorschlaege/{vorschlag_id}/ablehnen")
def ablehnen_vorschlag(
    vorschlag_id: str,
    current_user: User = Depends(get_current_user),
):
    doc_ref = db.collection("vorschlaege").document(vorschlag_id)
    doc = doc_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Vorschlag nicht gefunden.")
    data = doc.to_dict()
    if data.get("kunde_id") != current_user.user_id:
        raise HTTPException(status_code=403, detail="Zugriff verweigert.")
    if data.get("status") != "offen":
        raise HTTPException(status_code=400, detail="Vorschlag wurde bereits bearbeitet.")

    now = datetime.now(timezone.utc).isoformat()
    doc_ref.update({"status": "abgelehnt", "updated_at": now})
    return {"message": "Vorschlag abgelehnt.", "status": "abgelehnt"}


# ── Folders ──────────────────────────────────────────────────────────────

@app.get("/api/folders")
def list_folders(
    parent_id: Optional[str] = Query(None),
    versicherung_id: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
):
    query = db.collection("folders")

    if current_user.role == "kunde":
        query = query.where("owner_id", "==", current_user.user_id)
    if parent_id:
        query = query.where("parent_id", "==", parent_id)
    if versicherung_id:
        query = query.where("versicherung_id", "==", versicherung_id)

    docs = query.stream()
    folders = []
    for doc in docs:
        data = doc.to_dict()
        folders.append({
            "folder_id": doc.id,
            "name": data.get("name", ""),
            "parent_id": data.get("parent_id"),
            "versicherung_id": data.get("versicherung_id"),
            "owner_id": data.get("owner_id", ""),
            "created_at": data.get("created_at", ""),
        })
    return folders


@app.post("/api/folders")
def create_folder(folder: FolderCreate, current_user: User = Depends(require_role("admin", "berater"))):
    folder_id = str(uuid.uuid4())
    data = {
        "name": folder.name,
        "parent_id": folder.parent_id,
        "versicherung_id": folder.versicherung_id,
        "owner_id": current_user.user_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    db.collection("folders").document(folder_id).set(data)
    return {"message": "Ordner erstellt.", "folder_id": folder_id}


@app.delete("/api/folders/{folder_id}")
def delete_folder(folder_id: str, current_user: User = Depends(require_role("admin", "berater"))):
    doc_ref = db.collection("folders").document(folder_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Ordner nicht gefunden.")
    doc_ref.delete()
    return {"message": "Ordner gelöscht."}


# ── Files ────────────────────────────────────────────────────────────────

@app.get("/api/files")
def list_files(
    folder_id: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
):
    query = db.collection("files")
    if folder_id:
        query = query.where("folder_id", "==", folder_id)
    if current_user.role == "kunde":
        query = query.where("owner_id", "==", current_user.user_id)

    docs = query.stream()
    files = []
    for doc in docs:
        data = doc.to_dict()
        files.append({
            "file_id": doc.id,
            "name": data.get("name", ""),
            "folder_id": data.get("folder_id", ""),
            "size": data.get("size", 0),
            "content_type": data.get("content_type", ""),
            "uploaded_by": data.get("uploaded_by", ""),
            "created_at": data.get("created_at", ""),
            "download_url": data.get("download_url"),
        })
    return files


@app.post("/api/files/upload")
async def upload_file(
    file: UploadFile = File(...),
    folder_id: str = Form(...),
    current_user: User = Depends(get_current_user),
):
    if current_user.role == "kunde":
        folder_doc = db.collection("folders").document(folder_id).get()
        if not folder_doc.exists:
            raise HTTPException(status_code=404, detail="Ordner nicht gefunden.")
        folder_data = folder_doc.to_dict()
        if folder_data.get("owner_id") != current_user.user_id:
            raise HTTPException(status_code=403, detail="Zugriff verweigert.")

    content = await file.read()
    file_id = str(uuid.uuid4())
    storage_path = f"uploads/{current_user.user_id}/{folder_id}/{file_id}_{file.filename}"

    download_url = ""
    if upload_bucket:
        blob = upload_bucket.blob(storage_path)
        blob.upload_from_string(content, content_type=file.content_type)
        download_url = blob.public_url

    file_data = {
        "name": file.filename,
        "folder_id": folder_id,
        "size": len(content),
        "content_type": file.content_type or "application/octet-stream",
        "uploaded_by": current_user.user_id,
        "owner_id": current_user.user_id,
        "storage_path": storage_path,
        "download_url": download_url,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    db.collection("files").document(file_id).set(file_data)

    return {"message": "Datei hochgeladen.", "file_id": file_id, "name": file.filename}


@app.delete("/api/files/{file_id}")
def delete_file(file_id: str, current_user: User = Depends(require_role("admin", "berater"))):
    doc_ref = db.collection("files").document(file_id)
    doc = doc_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden.")

    data = doc.to_dict()
    if upload_bucket and data.get("storage_path"):
        try:
            blob = upload_bucket.blob(data["storage_path"])
            blob.delete()
        except Exception:
            pass

    doc_ref.delete()
    return {"message": "Datei gelöscht."}


# ── Frontend Serving (catch-all) ─────────────────────────────────────────

@app.get("/")
def root():
    return serve_frontend("")


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
