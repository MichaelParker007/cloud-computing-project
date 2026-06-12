import base64
import hashlib
import io
import os
import random
import secrets
import smtplib
import ssl
import sqlalchemy
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from pathlib import Path
from typing import Optional

import jwt
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from pydantic import BaseModel
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import RedirectResponse as StarletteRedirect

try:
    import pyotp
    import qrcode
    TOTP_AVAILABLE = True
except ImportError:
    pyotp = None
    qrcode = None
    TOTP_AVAILABLE = False

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")
load_dotenv()

from database import engine
from models import Base, User as SQLUser

# ── Config ────────────────────────────────────────────────────────────────

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
JWT_SECRET = os.getenv("JWT_SECRET", secrets.token_hex(32))
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "465"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
SMTP_FROM = os.getenv("SMTP_FROM", "noreply@versicherungs-hub.de")

# ── App ───────────────────────────────────────────────────────────────────

app = FastAPI(title="Auth Service")
Base.metadata.create_all(bind=engine)


class _ProxyHTTPSRedirect(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.headers.get("x-forwarded-proto") == "http":
            https_url = str(request.url).replace("http://", "https://", 1)
            return StarletteRedirect(url=https_url, status_code=301)
        return await call_next(request)


def _migrate_users_table():
    new_columns = {
        "nachname": "VARCHAR(255)",
        "alter_jahre": "INT",
        "adresse": "VARCHAR(512)",
        "telefon": "VARCHAR(50)",
        "familienstand": "VARCHAR(100)",
        "beruf": "VARCHAR(255)",
        "bankdaten_iban": "VARCHAR(34)",
        "bankdaten_bic": "VARCHAR(11)",
        "bankdaten_inhaber": "VARCHAR(255)",
        "two_factor_enabled": "BOOLEAN DEFAULT FALSE",
        "two_factor_method": "VARCHAR(20)",
        "totp_secret": "VARCHAR(255)",
        "notify_email_enabled": "BOOLEAN DEFAULT TRUE",
        "notify_neue_vorschlaege": "BOOLEAN DEFAULT TRUE",
        "notify_vertragsablauf": "BOOLEAN DEFAULT TRUE",
        "reset_code": "VARCHAR(10)",
        "reset_code_expires": "DATETIME",
        "pending_2fa_user_id": "INT",
    }
    try:
        with engine.connect() as conn:
            result = conn.execute(sqlalchemy.text("SHOW COLUMNS FROM users"))
            existing = {row[0] for row in result}
            for col_name, col_type in new_columns.items():
                if col_name not in existing:
                    conn.execute(sqlalchemy.text(f"ALTER TABLE users ADD COLUMN {col_name} {col_type}"))
            conn.commit()
    except Exception as e:
        print(f"[MIGRATION] Spalten-Migration übersprungen: {e}")


_migrate_users_table()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:4200",
        "http://127.0.0.1:4200",
        "https://project-64e4ee95-be58-4dea-8c0.ey.r.appspot.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(_ProxyHTTPSRedirect)

# ── Pydantic Models ───────────────────────────────────────────────────────

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

class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    nachname: Optional[str] = None
    alter: Optional[int] = None
    adresse: Optional[str] = None
    telefon: Optional[str] = None
    familienstand: Optional[str] = None
    beruf: Optional[str] = None
    bankdaten_iban: Optional[str] = None
    bankdaten_bic: Optional[str] = None
    bankdaten_inhaber: Optional[str] = None

class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str

class PasswordResetRequest(BaseModel):
    email: str

class PasswordResetVerify(BaseModel):
    email: str
    code: str

class PasswordResetConfirm(BaseModel):
    email: str
    code: str
    new_password: str

class TwoFactorSetupRequest(BaseModel):
    method: str  # "email" | "totp"

class TwoFactorVerifyRequest(BaseModel):
    code: str

class TwoFactorLoginVerify(BaseModel):
    user_id: str
    code: str
    method: str

class NotificationSettingsUpdate(BaseModel):
    notify_email_enabled: Optional[bool] = None
    notify_neue_vorschlaege: Optional[bool] = None
    notify_vertragsablauf: Optional[bool] = None

# ── Email ─────────────────────────────────────────────────────────────────

def send_email(to: str, subject: str, body: str) -> bool:
    if not SMTP_HOST or not SMTP_USER or not SMTP_PASS:
        print(f"[EMAIL-STUB] An: {to} | Betreff: {subject}")
        return False
    try:
        msg = MIMEText(body, "plain", "utf-8")
        msg["Subject"] = subject
        msg["From"] = SMTP_FROM
        msg["To"] = to
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=context) as server:
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
        return True
    except Exception as e:
        print(f"[EMAIL-ERROR] {type(e).__name__}: {e}")
        return False

# ── Password Hashing ──────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100000)
    return f"{salt}:{hashed.hex()}"

def verify_password(password: str, stored: str) -> bool:
    salt, hashed = stored.split(":")
    check = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100000)
    return check.hex() == hashed

# ── JWT ───────────────────────────────────────────────────────────────────

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

# ── Google Token Verification ─────────────────────────────────────────────

def verify_google_token(credential: str) -> dict:
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="GOOGLE_CLIENT_ID nicht konfiguriert.")
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
        raise HTTPException(status_code=401, detail=f"Ungültiger Google Token: {error}")

# ── Cloud SQL: User/Rolle laden ───────────────────────────────────────────

def get_or_create_user_from_google(google_info: dict) -> User:
    with Session(engine) as sql_db:
        sql_user = sql_db.query(SQLUser).filter(SQLUser.email == google_info["email"]).first()
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

# ── Auth Dependency ────────────────────────────────────────────────────────
#
# Flow:
#   1. Angular holt ID Token nach Login (JWT aus /api/auth/google oder /api/auth/login)
#   2. Angular sendet: Authorization: Bearer <jwt>
#   3. FastAPI liest Header, dekodiert JWT mit JWT_SECRET
#   4. Bei Google-Token-Fallback: Cloud SQL User/Rolle laden
#   5. require_role() prüft: kunde | berater | admin

def get_current_user(authorization: Optional[str] = Header(default=None)) -> User:
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization Header fehlt.")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization Header muss mit Bearer beginnen.")
    token = authorization.replace("Bearer ", "")
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
    # Fallback: direkter Google ID Token (z.B. bei erstem Login)
    google_info = verify_google_token(token)
    return get_or_create_user_from_google(google_info)


def require_role(*roles):
    def dependency(current_user: User = Depends(get_current_user)):
        if current_user.role not in roles:
            raise HTTPException(
                status_code=403,
                detail=f"Zugriff verweigert. Erforderliche Rolle: {', '.join(roles)}",
            )
        return current_user
    return dependency

# ══════════════════════════════════════════════════════════════════════════
# ROUTES
# ══════════════════════════════════════════════════════════════════════════

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/api/health")
def api_health():
    return {"status": "Auth Service läuft"}

# ── Auth: Google ──────────────────────────────────────────────────────────

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

# ── Auth: Email ───────────────────────────────────────────────────────────

@app.post("/api/auth/register")
def register_with_email(request: EmailRegisterRequest):
    with Session(engine) as sql_db:
        existing = sql_db.query(SQLUser).filter(SQLUser.email == request.email).first()
        if existing:
            raise HTTPException(status_code=409, detail="Ein Benutzer mit dieser E-Mail existiert bereits.")
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
        sql_user = sql_db.query(SQLUser).filter(SQLUser.email == request.email).first()
        if not sql_user:
            raise HTTPException(status_code=401, detail="E-Mail oder Passwort falsch.")
        if not sql_user.password_hash:
            raise HTTPException(status_code=401, detail="Bitte melden Sie sich mit Google an.")
        if not verify_password(request.password, sql_user.password_hash):
            raise HTTPException(status_code=401, detail="E-Mail oder Passwort falsch.")
        if sql_user.two_factor_enabled:
            if sql_user.two_factor_method == "email":
                code = f"{random.randint(0, 9999):04d}"
                sql_user.reset_code = code
                sql_user.reset_code_expires = datetime.now(timezone.utc) + timedelta(minutes=10)
                sql_db.commit()
                send_email(
                    to=sql_user.email,
                    subject="Ihr Login-Bestätigungscode",
                    body=f"Ihr Code für die Anmeldung: {code}\n\nDieser Code ist 10 Minuten gültig.",
                )
            return {
                "requires_2fa": True,
                "user_id": str(sql_user.id),
                "two_factor_method": sql_user.two_factor_method,
                "message": "Zwei-Faktor-Authentifizierung erforderlich.",
            }
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

# ── Current User ──────────────────────────────────────────────────────────

@app.get("/api/me")
def api_get_me(current_user: User = Depends(get_current_user)):
    return current_user.model_dump()

@app.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    return current_user.model_dump()

# ── Profile ───────────────────────────────────────────────────────────────

@app.get("/api/profile")
def get_profile(current_user: User = Depends(get_current_user)):
    with Session(engine) as sql_db:
        sql_user = sql_db.query(SQLUser).filter(SQLUser.id == int(current_user.user_id)).first()
        if not sql_user:
            raise HTTPException(status_code=404, detail="Benutzer nicht gefunden.")
        return {
            "user_id": str(sql_user.id),
            "email": sql_user.email,
            "name": sql_user.name or "",
            "nachname": sql_user.nachname or "",
            "alter": sql_user.alter_jahre,
            "adresse": sql_user.adresse or "",
            "telefon": sql_user.telefon or "",
            "familienstand": sql_user.familienstand or "",
            "beruf": sql_user.beruf or "",
            "bankdaten_iban": sql_user.bankdaten_iban or "",
            "bankdaten_bic": sql_user.bankdaten_bic or "",
            "bankdaten_inhaber": sql_user.bankdaten_inhaber or "",
            "auth_provider": sql_user.auth_provider or "email",
            "picture": sql_user.picture,
            "role": sql_user.role or "kunde",
            "two_factor_enabled": sql_user.two_factor_enabled or False,
            "two_factor_method": sql_user.two_factor_method or "",
            "notify_email_enabled": sql_user.notify_email_enabled if sql_user.notify_email_enabled is not None else True,
            "notify_neue_vorschlaege": sql_user.notify_neue_vorschlaege if sql_user.notify_neue_vorschlaege is not None else True,
            "notify_vertragsablauf": sql_user.notify_vertragsablauf if sql_user.notify_vertragsablauf is not None else True,
        }


@app.put("/api/profile")
def update_profile(update: ProfileUpdate, current_user: User = Depends(get_current_user)):
    with Session(engine) as sql_db:
        sql_user = sql_db.query(SQLUser).filter(SQLUser.id == int(current_user.user_id)).first()
        if not sql_user:
            raise HTTPException(status_code=404, detail="Benutzer nicht gefunden.")
        if update.name is not None:
            sql_user.name = update.name
        if update.nachname is not None:
            sql_user.nachname = update.nachname
        if update.alter is not None:
            sql_user.alter_jahre = update.alter
        if update.adresse is not None:
            sql_user.adresse = update.adresse
        if update.telefon is not None:
            sql_user.telefon = update.telefon
        if update.familienstand is not None:
            sql_user.familienstand = update.familienstand
        if update.beruf is not None:
            sql_user.beruf = update.beruf
        if update.bankdaten_iban is not None:
            sql_user.bankdaten_iban = update.bankdaten_iban
        if update.bankdaten_bic is not None:
            sql_user.bankdaten_bic = update.bankdaten_bic
        if update.bankdaten_inhaber is not None:
            sql_user.bankdaten_inhaber = update.bankdaten_inhaber
        sql_db.commit()
        return {"message": "Profil aktualisiert."}


@app.put("/api/profile/password")
def change_password(body: PasswordChangeRequest, current_user: User = Depends(get_current_user)):
    with Session(engine) as sql_db:
        sql_user = sql_db.query(SQLUser).filter(SQLUser.id == int(current_user.user_id)).first()
        if not sql_user:
            raise HTTPException(status_code=404, detail="Benutzer nicht gefunden.")
        if not sql_user.password_hash:
            raise HTTPException(status_code=400, detail="Passwortänderung nicht möglich für Google-Konten.")
        if not verify_password(body.current_password, sql_user.password_hash):
            raise HTTPException(status_code=401, detail="Aktuelles Passwort ist falsch.")
        if len(body.new_password) < 6:
            raise HTTPException(status_code=400, detail="Neues Passwort muss mindestens 6 Zeichen lang sein.")
        sql_user.password_hash = hash_password(body.new_password)
        sql_db.commit()
        return {"message": "Passwort erfolgreich geändert."}

# ── Password Reset ────────────────────────────────────────────────────────

@app.post("/api/auth/password-reset/request")
def request_password_reset(body: PasswordResetRequest):
    with Session(engine) as sql_db:
        sql_user = sql_db.query(SQLUser).filter(SQLUser.email == body.email).first()
        if not sql_user or not sql_user.password_hash:
            return {"message": "Falls ein Konto mit dieser E-Mail existiert, wurde ein Code gesendet."}
        code = f"{random.randint(0, 9999):04d}"
        sql_user.reset_code = code
        sql_user.reset_code_expires = datetime.now(timezone.utc) + timedelta(minutes=15)
        sql_db.commit()
        send_email(
            to=body.email,
            subject="Ihr Passwort-Reset-Code",
            body=f"Ihr Code zum Zurücksetzen des Passworts lautet: {code}\n\nDieser Code ist 15 Minuten gültig.",
        )
        return {"message": "Falls ein Konto mit dieser E-Mail existiert, wurde ein Code gesendet."}


@app.post("/api/auth/password-reset/verify")
def verify_reset_code(body: PasswordResetVerify):
    with Session(engine) as sql_db:
        sql_user = sql_db.query(SQLUser).filter(SQLUser.email == body.email).first()
        if not sql_user or not sql_user.reset_code:
            raise HTTPException(status_code=400, detail="Ungültiger Code.")
        if sql_user.reset_code_expires and sql_user.reset_code_expires.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
            sql_user.reset_code = None
            sql_user.reset_code_expires = None
            sql_db.commit()
            raise HTTPException(status_code=400, detail="Code ist abgelaufen.")
        if sql_user.reset_code != body.code:
            raise HTTPException(status_code=400, detail="Ungültiger Code.")
        return {"message": "Code verifiziert.", "valid": True}


@app.post("/api/auth/password-reset/confirm")
def confirm_password_reset(body: PasswordResetConfirm):
    with Session(engine) as sql_db:
        sql_user = sql_db.query(SQLUser).filter(SQLUser.email == body.email).first()
        if not sql_user or not sql_user.reset_code:
            raise HTTPException(status_code=400, detail="Ungültiger Reset-Vorgang.")
        if sql_user.reset_code_expires and sql_user.reset_code_expires.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
            sql_user.reset_code = None
            sql_user.reset_code_expires = None
            sql_db.commit()
            raise HTTPException(status_code=400, detail="Code ist abgelaufen.")
        if sql_user.reset_code != body.code:
            raise HTTPException(status_code=400, detail="Ungültiger Code.")
        if len(body.new_password) < 6:
            raise HTTPException(status_code=400, detail="Passwort muss mindestens 6 Zeichen lang sein.")
        sql_user.password_hash = hash_password(body.new_password)
        sql_user.reset_code = None
        sql_user.reset_code_expires = None
        sql_db.commit()
        return {"message": "Passwort erfolgreich zurückgesetzt."}

# ── Two-Factor Authentication ─────────────────────────────────────────────

@app.post("/api/profile/2fa/setup")
def setup_two_factor(body: TwoFactorSetupRequest, current_user: User = Depends(get_current_user)):
    if body.method not in ("email", "totp"):
        raise HTTPException(status_code=400, detail="Ungültige 2FA-Methode. Erlaubt: email, totp")
    with Session(engine) as sql_db:
        sql_user = sql_db.query(SQLUser).filter(SQLUser.id == int(current_user.user_id)).first()
        if not sql_user:
            raise HTTPException(status_code=404, detail="Benutzer nicht gefunden.")
        if body.method == "totp":
            if not TOTP_AVAILABLE:
                raise HTTPException(status_code=501, detail="TOTP-Bibliothek nicht installiert.")
            secret = pyotp.random_base32()
            sql_user.totp_secret = secret
            sql_user.two_factor_method = "totp"
            sql_db.commit()
            totp = pyotp.TOTP(secret)
            uri = totp.provisioning_uri(name=sql_user.email, issuer_name="Versicherungs-Hub")
            img = qrcode.make(uri)
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            qr_base64 = base64.b64encode(buf.getvalue()).decode()
            return {
                "method": "totp",
                "secret": secret,
                "qr_code": f"data:image/png;base64,{qr_base64}",
                "message": "Scannen Sie den QR-Code mit Ihrer Authenticator-App.",
            }
        code = f"{random.randint(0, 9999):04d}"
        sql_user.reset_code = code
        sql_user.reset_code_expires = datetime.now(timezone.utc) + timedelta(minutes=10)
        sql_user.two_factor_method = "email"
        sql_db.commit()
        send_email(
            to=sql_user.email,
            subject="Ihr 2FA-Bestätigungscode",
            body=f"Ihr Code zur Aktivierung der Zwei-Faktor-Authentifizierung: {code}",
        )
        return {"method": "email", "message": "Ein Bestätigungscode wurde an Ihre E-Mail gesendet."}


@app.post("/api/profile/2fa/verify")
def verify_two_factor_setup(body: TwoFactorVerifyRequest, current_user: User = Depends(get_current_user)):
    with Session(engine) as sql_db:
        sql_user = sql_db.query(SQLUser).filter(SQLUser.id == int(current_user.user_id)).first()
        if not sql_user:
            raise HTTPException(status_code=404, detail="Benutzer nicht gefunden.")
        method = sql_user.two_factor_method
        if method == "totp":
            if not TOTP_AVAILABLE or not sql_user.totp_secret:
                raise HTTPException(status_code=400, detail="TOTP nicht eingerichtet.")
            totp = pyotp.TOTP(sql_user.totp_secret)
            if not totp.verify(body.code, valid_window=1):
                raise HTTPException(status_code=400, detail="Ungültiger Code.")
        elif method == "email":
            if not sql_user.reset_code or sql_user.reset_code != body.code:
                raise HTTPException(status_code=400, detail="Ungültiger Code.")
            if sql_user.reset_code_expires and sql_user.reset_code_expires.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
                raise HTTPException(status_code=400, detail="Code abgelaufen.")
            sql_user.reset_code = None
            sql_user.reset_code_expires = None
        else:
            raise HTTPException(status_code=400, detail="Keine 2FA-Methode konfiguriert.")
        sql_user.two_factor_enabled = True
        sql_db.commit()
        return {"message": "Zwei-Faktor-Authentifizierung aktiviert.", "enabled": True}


@app.post("/api/profile/2fa/disable")
def disable_two_factor(current_user: User = Depends(get_current_user)):
    with Session(engine) as sql_db:
        sql_user = sql_db.query(SQLUser).filter(SQLUser.id == int(current_user.user_id)).first()
        if not sql_user:
            raise HTTPException(status_code=404, detail="Benutzer nicht gefunden.")
        sql_user.two_factor_enabled = False
        sql_user.two_factor_method = None
        sql_user.totp_secret = None
        sql_db.commit()
        return {"message": "Zwei-Faktor-Authentifizierung deaktiviert.", "enabled": False}


@app.post("/api/auth/2fa/send-code")
def send_2fa_login_code(body: PasswordResetRequest):
    with Session(engine) as sql_db:
        sql_user = sql_db.query(SQLUser).filter(SQLUser.email == body.email).first()
        if not sql_user or not sql_user.two_factor_enabled:
            return {"message": "Code gesendet."}
        code = f"{random.randint(0, 9999):04d}"
        sql_user.reset_code = code
        sql_user.reset_code_expires = datetime.now(timezone.utc) + timedelta(minutes=10)
        sql_db.commit()
        send_email(
            to=sql_user.email,
            subject="Ihr Login-Bestätigungscode",
            body=f"Ihr Code für die Anmeldung: {code}\n\nDieser Code ist 10 Minuten gültig.",
        )
        return {"message": "Code gesendet."}


@app.post("/api/auth/2fa/verify")
def verify_2fa_login(body: TwoFactorLoginVerify):
    with Session(engine) as sql_db:
        sql_user = sql_db.query(SQLUser).filter(SQLUser.id == int(body.user_id)).first()
        if not sql_user:
            raise HTTPException(status_code=401, detail="Benutzer nicht gefunden.")
        if body.method == "totp":
            if not TOTP_AVAILABLE or not sql_user.totp_secret:
                raise HTTPException(status_code=400, detail="TOTP nicht eingerichtet.")
            totp = pyotp.TOTP(sql_user.totp_secret)
            if not totp.verify(body.code, valid_window=1):
                raise HTTPException(status_code=401, detail="Ungültiger Code.")
        elif body.method == "email":
            if not sql_user.reset_code or sql_user.reset_code != body.code:
                raise HTTPException(status_code=401, detail="Ungültiger Code.")
            if sql_user.reset_code_expires and sql_user.reset_code_expires.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
                raise HTTPException(status_code=401, detail="Code abgelaufen.")
            sql_user.reset_code = None
            sql_user.reset_code_expires = None
        else:
            raise HTTPException(status_code=400, detail="Ungültige Methode.")
        sql_user.last_login = datetime.utcnow()
        sql_db.commit()
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

# ── Notification Settings ─────────────────────────────────────────────────

@app.put("/api/profile/notifications")
def update_notification_settings(body: NotificationSettingsUpdate, current_user: User = Depends(get_current_user)):
    with Session(engine) as sql_db:
        sql_user = sql_db.query(SQLUser).filter(SQLUser.id == int(current_user.user_id)).first()
        if not sql_user:
            raise HTTPException(status_code=404, detail="Benutzer nicht gefunden.")
        if body.notify_email_enabled is not None:
            sql_user.notify_email_enabled = body.notify_email_enabled
        if body.notify_neue_vorschlaege is not None:
            sql_user.notify_neue_vorschlaege = body.notify_neue_vorschlaege
        if body.notify_vertragsablauf is not None:
            sql_user.notify_vertragsablauf = body.notify_vertragsablauf
        sql_db.commit()
        return {"message": "Benachrichtigungseinstellungen aktualisiert."}

# ── User Management (Admin) ───────────────────────────────────────────────

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
