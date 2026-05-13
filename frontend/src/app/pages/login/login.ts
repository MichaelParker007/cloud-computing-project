import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login implements OnInit {
  errorMessage = '';

  constructor(
    private router: Router,
    private authService: AuthService,
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      await this.authService.initAuth();

      if (this.authService.isLoggedIn()) {
        this.router.navigate(['/versicherungen']);
      }
    } catch (error) {
      console.error('Auth Initialisierung fehlgeschlagen:', error);
      this.errorMessage = 'Google-Anmeldung konnte nicht vorbereitet werden.';
    }
  }

  async onLogin(): Promise<void> {
    try {
      await this.authService.initAuth();
      this.authService.login();
    } catch (error) {
      console.error('Login konnte nicht gestartet werden:', error);
      this.errorMessage = 'Google-Anmeldung konnte nicht gestartet werden.';
    }
  }
}
