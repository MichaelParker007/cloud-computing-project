import os
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import jwt
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")
load_dotenv()

JWT_SECRET = os.getenv("JWT_SECRET", secrets.token_hex(32))
JWT_ALGORITHM = "HS256"

app = FastAPI(title="Notification Service")

# ── Pydantic Models ───────────────────────────────────────────────────────

class NotifyRequest(BaseModel):
    user_id: str
    type: str        # "neue_vorschlaege" | "vertragsablauf" | "allgemein"
    subject: str
    message: str

class NotifyResponse(BaseModel):
    status: str
    user_id: str
    type: str
    queued_at: str

# ── Auth Dependency ────────────────────────────────────────────────────────
#
# Flow:
#   1. Nur interne Services rufen diesen Service auf (login: admin in app.yaml)
#   2. Aufrufende Services senden: Authorization: Bearer <jwt>
#   3. JWT wird mit gemeinsamem JWT_SECRET dekodiert
#   4. Nur berater/admin dürfen Benachrichtigungen auslösen

def get_current_user_from_jwt(authorization: Optional[str] = Header(default=None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization Header fehlt.")
    token = authorization.replace("Bearer ", "")
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token abgelaufen.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Ungültiger Token.")

# ══════════════════════════════════════════════════════════════════════════
# ROUTES
# ══════════════════════════════════════════════════════════════════════════

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/api/health")
def api_health():
    return {"status": "Notification Service läuft"}


@app.post("/api/notify", response_model=NotifyResponse)
def send_notification(body: NotifyRequest):
    """
    Platzhalter: Benachrichtigung in die Queue stellen.
    Zukünftig: User-Präferenzen aus auth-service laden,
    dann Email/Push via Cloud Tasks versenden.
    """
    print(f"[NOTIFY] user={body.user_id} type={body.type} subject={body.subject}")
    return NotifyResponse(
        status="queued",
        user_id=body.user_id,
        type=body.type,
        queued_at=datetime.now(timezone.utc).isoformat(),
    )


@app.get("/api/notify/types")
def list_notification_types():
    """Gibt verfügbare Benachrichtigungstypen zurück."""
    return {
        "types": [
            {"id": "neue_vorschlaege", "label": "Neuer Vorschlag vom Berater"},
            {"id": "vertragsablauf", "label": "Vertrag läuft demnächst ab"},
            {"id": "allgemein", "label": "Allgemeine Systemnachricht"},
        ]
    }
