import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login implements OnInit {
  mode: 'login' | 'register' = 'login';
  errorMessage = '';
  isLoading = false;

  // Email form
  email = '';
  password = '';
  name = '';
  confirmPassword = '';

  constructor(
    private router: Router,
    private authService: AuthService,
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      await this.authService.initAuth();

      // Check if returning from Google OAuth
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

    const result = await this.authService.loginWithEmail(this.email, this.password);

    this.isLoading = false;

    if (result.success) {
      this.router.navigate(['/dashboard']);
    } else {
      this.errorMessage = result.error || 'Anmeldung fehlgeschlagen.';
    }
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

  toggleMode(): void {
    this.mode = this.mode === 'login' ? 'register' : 'login';
    this.errorMessage = '';
  }
}
