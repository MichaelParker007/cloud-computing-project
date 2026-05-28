from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text
from sqlalchemy.orm import declarative_base

Base = declarative_base()

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    google_sub = Column(String(255), unique=True, nullable=True)
    email = Column(String(255), unique=True, nullable=False)
    name = Column(String(255))
    picture = Column(String(1024))
    password_hash = Column(String(512), nullable=True)
    auth_provider = Column(String(50), default="email")
    role = Column(String(50), default="kunde")
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime, default=datetime.utcnow)

    nachname = Column(String(255), nullable=True)
    alter_jahre = Column(Integer, nullable=True)
    adresse = Column(String(512), nullable=True)
    telefon = Column(String(50), nullable=True)
    familienstand = Column(String(100), nullable=True)
    beruf = Column(String(255), nullable=True)
    bankdaten_iban = Column(String(34), nullable=True)
    bankdaten_bic = Column(String(11), nullable=True)
    bankdaten_inhaber = Column(String(255), nullable=True)

    two_factor_enabled = Column(Boolean, default=False)
    two_factor_method = Column(String(20), nullable=True)
    totp_secret = Column(String(255), nullable=True)

    notify_email_enabled = Column(Boolean, default=True)
    notify_neue_vorschlaege = Column(Boolean, default=True)
    notify_vertragsablauf = Column(Boolean, default=True)

    reset_code = Column(String(10), nullable=True)
    reset_code_expires = Column(DateTime, nullable=True)
    pending_2fa_user_id = Column(Integer, nullable=True)
