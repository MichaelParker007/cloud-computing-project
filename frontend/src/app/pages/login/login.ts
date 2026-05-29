import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login implements OnInit {
  mode: 'login' | 'register' | 'reset-request' | 'reset-code' | 'reset-newpw' | '2fa' = 'login';
  errorMessage = '';
  successMessage = '';
  isLoading = false;

  // Email form
  email = '';
  password = '';
  name = '';
  confirmPassword = '';

  // Password reset
  resetEmail = '';
  resetCode = '';
  resetNewPassword = '';
  resetConfirmPassword = '';

  // 2FA
  twoFAUserId = '';
  twoFAMethod = '';
  twoFACode = '';

  private apiUrl = '/api';

  constructor(
    private router: Router,
    private authService: AuthService,
    private http: HttpClient,
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      await this.authService.initAuth();

      const handled = await this.authService.handleGoogleCallback();
      if (handled) {
        this.router.navigate(['/dashboard']);
        return;
      }

      if (this.authService.isLoggedIn()) {
        this.router.navigate(['/dashboard']);
      }
    } catch (error) {
      console.error('Auth Initialisierung fehlgeschlagen:', error);
    }
  }

  async onGoogleLogin(): Promise<void> {
    try {
      await this.authService.initAuth();
      this.authService.loginWithGoogle();
    } catch (error) {
      console.error('Google Login fehlgeschlagen:', error);
      this.errorMessage = 'Google-Anmeldung konnte nicht gestartet werden.';
    }
  }

  async onEmailLogin(): Promise<void> {
    if (!this.email || !this.password) {
      this.errorMessage = 'Bitte E-Mail und Passwort eingeben.';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    try {
      const response: any = await this.http
        .post(`${this.apiUrl}/auth/login`, { email: this.email, password: this.password })
        .toPromise();

      if (response.requires_2fa) {
        this.twoFAUserId = response.user_id;
        this.twoFAMethod = response.two_factor_method;
        this.twoFACode = '';
        this.mode = '2fa';
        this.isLoading = false;
        return;
      }

      this.authService.completeLogin(response.token, response.user);
      this.router.navigate(['/dashboard']);
    } catch (error: any) {
      this.errorMessage = error?.error?.detail || 'Anmeldung fehlgeschlagen.';
    }
    this.isLoading = false;
  }

  async verify2FA(): Promise<void> {
    if (!this.twoFACode || this.twoFACode.length < 4) {
      this.errorMessage = 'Bitte gültigen Code eingeben.';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    try {
      const response: any = await this.http
        .post(`${this.apiUrl}/auth/2fa/verify`, {
          user_id: this.twoFAUserId,
          code: this.twoFACode,
          method: this.twoFAMethod,
        })
        .toPromise();

      this.authService.completeLogin(response.token, response.user);
      this.router.navigate(['/dashboard']);
    } catch (error: any) {
      this.errorMessage = error?.error?.detail || 'Ungültiger Code.';
    }
    this.isLoading = false;
  }

  async onRegister(): Promise<void> {
    if (!this.name || !this.email || !this.password) {
      this.errorMessage = 'Bitte alle Felder ausfüllen.';
      return;
    }

    if (this.password !== this.confirmPassword) {
      this.errorMessage = 'Passwörter stimmen nicht überein.';
      return;
    }

    if (this.password.length < 6) {
      this.errorMessage = 'Passwort muss mindestens 6 Zeichen lang sein.';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    const result = await this.authService.registerWithEmail(
      this.name,
      this.email,
      this.password,
    );

    this.isLoading = false;

    if (result.success) {
      this.router.navigate(['/dashboard']);
    } else {
      this.errorMessage = result.error || 'Registrierung fehlgeschlagen.';
    }
  }

  openPasswordReset(): void {
    this.mode = 'reset-request';
    this.resetEmail = this.email || '';
    this.errorMessage = '';
    this.successMessage = '';
  }

  async requestResetCode(): Promise<void> {
    if (!this.resetEmail) {
      this.errorMessage = 'Bitte E-Mail-Adresse eingeben.';
      return;
    }
    this.isLoading = true;
    this.errorMessage = '';

    try {
      await this.http
        .post(`${this.apiUrl}/auth/password-reset/request`, { email: this.resetEmail })
        .toPromise();
      this.mode = 'reset-code';
      this.successMessage = 'Ein Code wurde an Ihre E-Mail gesendet.';
    } catch (error: any) {
      this.errorMessage = error?.error?.detail || 'Fehler beim Senden des Codes.';
    }
    this.isLoading = false;
  }

  async verifyResetCode(): Promise<void> {
    if (!this.resetCode || this.resetCode.length < 4) {
      this.errorMessage = 'Bitte den 4-stelligen Code eingeben.';
      return;
    }
    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      await this.http
        .post(`${this.apiUrl}/auth/password-reset/verify`, {
          email: this.resetEmail,
          code: this.resetCode,
        })
        .toPromise();
      this.mode = 'reset-newpw';
    } catch (error: any) {
      this.errorMessage = error?.error?.detail || 'Ungültiger Code.';
    }
    this.isLoading = false;
  }

  async confirmResetPassword(): Promise<void> {
    if (!this.resetNewPassword || this.resetNewPassword.length < 6) {
      this.errorMessage = 'Passwort muss mindestens 6 Zeichen lang sein.';
      return;
    }
    if (this.resetNewPassword !== this.resetConfirmPassword) {
      this.errorMessage = 'Passwörter stimmen nicht überein.';
      return;
    }
    this.isLoading = true;
    this.errorMessage = '';

    try {
      await this.http
        .post(`${this.apiUrl}/auth/password-reset/confirm`, {
          email: this.resetEmail,
          code: this.resetCode,
          new_password: this.resetNewPassword,
        })
        .toPromise();
      this.successMessage = 'Passwort erfolgreich zurückgesetzt. Sie können sich jetzt anmelden.';
      this.mode = 'login';
      this.resetEmail = '';
      this.resetCode = '';
      this.resetNewPassword = '';
      this.resetConfirmPassword = '';
    } catch (error: any) {
      this.errorMessage = error?.error?.detail || 'Fehler beim Zurücksetzen.';
    }
    this.isLoading = false;
  }

  backToLogin(): void {
    this.mode = 'login';
    this.errorMessage = '';
    this.successMessage = '';
    this.resetCode = '';
    this.resetNewPassword = '';
    this.resetConfirmPassword = '';
    this.twoFACode = '';
  }

  toggleMode(): void {
    this.mode = this.mode === 'login' ? 'register' : 'login';
    this.errorMessage = '';
    this.successMessage = '';
  }
}
