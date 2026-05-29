import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-mein-bereich',
  imports: [CommonModule, FormsModule],
  templateUrl: './mein-bereich.html',
  styleUrl: './mein-bereich.css',
})
export class MeinBereich implements OnInit {
  @Output() close = new EventEmitter<void>();

  activeTab: 'profil' | 'sicherheit' | 'benachrichtigungen' = 'profil';

  profile: any = {};
  originalProfile: any = {};
  isLoading = true;
  isSaving = false;
  successMessage = '';
  errorMessage = '';

  // Password change
  currentPassword = '';
  newPassword = '';
  confirmNewPassword = '';
  passwordMessage = '';
  passwordError = '';
  isChangingPassword = false;

  // 2FA
  twoFactorEnabled = false;
  twoFactorMethod = '';
  setupMethod = 'email';
  qrCode = '';
  totpSecret = '';
  verifyCode = '';
  is2FASetup = false;
  twoFAMessage = '';
  twoFAError = '';
  isSettingUp2FA = false;

  // Notifications
  notifyEmailEnabled = true;
  notifyNeueVorschlaege = true;
  notifyVertragsablauf = true;
  notifMessage = '';
  notifError = '';
  isSavingNotif = false;

  private apiUrl = '/api';

  constructor(
    private http: HttpClient,
    private authService: AuthService,
  ) {}

  ngOnInit(): void {
    this.loadProfile();
  }

  private getHeaders(): HttpHeaders {
    return new HttpHeaders({
      Authorization: `Bearer ${this.authService.getToken()}`,
    });
  }

  loadProfile(): void {
    this.isLoading = true;
    this.http.get<any>(`${this.apiUrl}/profile`, { headers: this.getHeaders() }).subscribe({
      next: (data) => {
        this.profile = { ...data };
        this.originalProfile = { ...data };
        this.twoFactorEnabled = data.two_factor_enabled || false;
        this.twoFactorMethod = data.two_factor_method || '';
        this.notifyEmailEnabled = data.notify_email_enabled !== false;
        this.notifyNeueVorschlaege = data.notify_neue_vorschlaege !== false;
        this.notifyVertragsablauf = data.notify_vertragsablauf !== false;
        this.isLoading = false;
      },
      error: () => {
        this.errorMessage = 'Profildaten konnten nicht geladen werden.';
        this.isLoading = false;
      },
    });
  }

  saveProfile(): void {
    this.isSaving = true;
    this.successMessage = '';
    this.errorMessage = '';

    const payload = {
      name: this.profile.name,
      nachname: this.profile.nachname,
      alter: this.profile.alter,
      adresse: this.profile.adresse,
      telefon: this.profile.telefon,
      familienstand: this.profile.familienstand,
      beruf: this.profile.beruf,
      bankdaten_iban: this.profile.bankdaten_iban,
      bankdaten_bic: this.profile.bankdaten_bic,
      bankdaten_inhaber: this.profile.bankdaten_inhaber,
    };

    this.http.put<any>(`${this.apiUrl}/profile`, payload, { headers: this.getHeaders() }).subscribe({
      next: () => {
        this.successMessage = 'Profil erfolgreich gespeichert.';
        this.originalProfile = { ...this.profile };
        this.isSaving = false;
        this.updateLocalUser();
        setTimeout(() => (this.successMessage = ''), 3000);
      },
      error: (err) => {
        this.errorMessage = err?.error?.detail || 'Fehler beim Speichern.';
        this.isSaving = false;
      },
    });
  }

  cancelProfile(): void {
    this.profile = { ...this.originalProfile };
    this.errorMessage = '';
    this.successMessage = '';
  }

  private updateLocalUser(): void {
    const current = this.authService.getCurrentUser();
    if (current) {
      const updated = { ...current, name: this.profile.name || current.name };
      localStorage.setItem('user', JSON.stringify(updated));
      (this.authService as any).currentUserSubject?.next(updated);
    }
  }

  changePassword(): void {
    this.passwordError = '';
    this.passwordMessage = '';

    if (!this.currentPassword || !this.newPassword) {
      this.passwordError = 'Bitte alle Felder ausfüllen.';
      return;
    }
    if (this.newPassword.length < 6) {
      this.passwordError = 'Neues Passwort muss mindestens 6 Zeichen lang sein.';
      return;
    }
    if (this.newPassword !== this.confirmNewPassword) {
      this.passwordError = 'Neue Passwörter stimmen nicht überein.';
      return;
    }

    this.isChangingPassword = true;
    this.http
      .put<any>(
        `${this.apiUrl}/profile/password`,
        { current_password: this.currentPassword, new_password: this.newPassword },
        { headers: this.getHeaders() },
      )
      .subscribe({
        next: () => {
          this.passwordMessage = 'Passwort erfolgreich geändert.';
          this.currentPassword = '';
          this.newPassword = '';
          this.confirmNewPassword = '';
          this.isChangingPassword = false;
          setTimeout(() => (this.passwordMessage = ''), 3000);
        },
        error: (err) => {
          this.passwordError = err?.error?.detail || 'Fehler beim Ändern des Passworts.';
          this.isChangingPassword = false;
        },
      });
  }

  setup2FA(): void {
    this.twoFAError = '';
    this.twoFAMessage = '';
    this.isSettingUp2FA = true;

    this.http
      .post<any>(
        `${this.apiUrl}/profile/2fa/setup`,
        { method: this.setupMethod },
        { headers: this.getHeaders() },
      )
      .subscribe({
        next: (res) => {
          this.is2FASetup = true;
          if (res.qr_code) {
            this.qrCode = res.qr_code;
            this.totpSecret = res.secret;
          }
          this.twoFAMessage = res.message;
          this.isSettingUp2FA = false;
        },
        error: (err) => {
          this.twoFAError = err?.error?.detail || 'Fehler bei der 2FA-Einrichtung.';
          this.isSettingUp2FA = false;
        },
      });
  }

  verify2FA(): void {
    this.twoFAError = '';

    if (!this.verifyCode || this.verifyCode.length < 4) {
      this.twoFAError = 'Bitte gültigen Code eingeben.';
      return;
    }

    this.http
      .post<any>(
        `${this.apiUrl}/profile/2fa/verify`,
        { code: this.verifyCode },
        { headers: this.getHeaders() },
      )
      .subscribe({
        next: () => {
          this.twoFactorEnabled = true;
          this.twoFactorMethod = this.setupMethod;
          this.is2FASetup = false;
          this.verifyCode = '';
          this.qrCode = '';
          this.totpSecret = '';
          this.twoFAMessage = 'Zwei-Faktor-Authentifizierung erfolgreich aktiviert.';
          setTimeout(() => (this.twoFAMessage = ''), 3000);
        },
        error: (err) => {
          this.twoFAError = err?.error?.detail || 'Ungültiger Code.';
        },
      });
  }

  disable2FA(): void {
    this.http
      .post<any>(`${this.apiUrl}/profile/2fa/disable`, {}, { headers: this.getHeaders() })
      .subscribe({
        next: () => {
          this.twoFactorEnabled = false;
          this.twoFactorMethod = '';
          this.is2FASetup = false;
          this.twoFAMessage = 'Zwei-Faktor-Authentifizierung deaktiviert.';
          setTimeout(() => (this.twoFAMessage = ''), 3000);
        },
        error: (err) => {
          this.twoFAError = err?.error?.detail || 'Fehler beim Deaktivieren.';
        },
      });
  }

  cancel2FASetup(): void {
    this.is2FASetup = false;
    this.qrCode = '';
    this.totpSecret = '';
    this.verifyCode = '';
    this.twoFAError = '';
    this.twoFAMessage = '';
  }

  saveNotifications(): void {
    this.notifError = '';
    this.notifMessage = '';
    this.isSavingNotif = true;

    this.http
      .put<any>(
        `${this.apiUrl}/profile/notifications`,
        {
          notify_email_enabled: this.notifyEmailEnabled,
          notify_neue_vorschlaege: this.notifyNeueVorschlaege,
          notify_vertragsablauf: this.notifyVertragsablauf,
        },
        { headers: this.getHeaders() },
      )
      .subscribe({
        next: () => {
          this.notifMessage = 'Benachrichtigungseinstellungen gespeichert.';
          this.isSavingNotif = false;
          setTimeout(() => (this.notifMessage = ''), 3000);
        },
        error: (err) => {
          this.notifError = err?.error?.detail || 'Fehler beim Speichern.';
          this.isSavingNotif = false;
        },
      });
  }

  onOverlayClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal-overlay')) {
      this.close.emit();
    }
  }

  get isGoogleOnly(): boolean {
    return this.profile.auth_provider === 'google' && !this.profile.password_hash;
  }
}
