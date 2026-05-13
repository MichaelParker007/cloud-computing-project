import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { OAuthService } from 'angular-oauth2-oidc';
import { authConfig } from '../auth.config';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable } from 'rxjs';

export interface UserInfo {
  user_id: string;
  name: string;
  email: string;
  role: 'admin' | 'berater' | 'kunde';
  picture?: string;
  auth_provider: string;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private initialized = false;
  private currentUserSubject = new BehaviorSubject<UserInfo | null>(null);
  currentUser$ = this.currentUserSubject.asObservable();

  private apiUrl = '/api';

  constructor(
    private oauthService: OAuthService,
    private http: HttpClient,
    private router: Router,
  ) {
    const stored = localStorage.getItem('user');
    if (stored) {
      try {
        this.currentUserSubject.next(JSON.parse(stored));
      } catch {}
    }
  }

  async initAuth(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.oauthService.configure(authConfig);
    await this.oauthService.loadDiscoveryDocumentAndTryLogin();
    this.initialized = true;
  }

  // Google Login
  loginWithGoogle(): void {
    this.oauthService.initLoginFlow();
  }

  async handleGoogleCallback(): Promise<boolean> {
    await this.initAuth();
    if (this.oauthService.hasValidIdToken()) {
      const credential = this.oauthService.getIdToken();
      try {
        const response: any = await this.http
          .post(`${this.apiUrl}/auth/google`, { credential })
          .toPromise();

        this.setSession(response.token, response.user);
        return true;
      } catch (error) {
        console.error('Google Auth Backend-Fehler:', error);
        return false;
      }
    }
    return false;
  }

  // Email Login
  async loginWithEmail(
    email: string,
    password: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response: any = await this.http
        .post(`${this.apiUrl}/auth/login`, { email, password })
        .toPromise();

      this.setSession(response.token, response.user);
      return { success: true };
    } catch (error: any) {
      const msg =
        error?.error?.detail || 'Anmeldung fehlgeschlagen.';
      return { success: false, error: msg };
    }
  }

  // Email Register
  async registerWithEmail(
    name: string,
    email: string,
    password: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response: any = await this.http
        .post(`${this.apiUrl}/auth/register`, { name, email, password })
        .toPromise();

      this.setSession(response.token, response.user);
      return { success: true };
    } catch (error: any) {
      const msg =
        error?.error?.detail || 'Registrierung fehlgeschlagen.';
      return { success: false, error: msg };
    }
  }

  private setSession(token: string, user: UserInfo): void {
    localStorage.setItem('auth_token', token);
    localStorage.setItem('user', JSON.stringify(user));
    this.currentUserSubject.next(user);
  }

  logout(): void {
    try {
      this.oauthService.logOut();
    } catch {}
    localStorage.clear();
    sessionStorage.clear();
    this.currentUserSubject.next(null);
    this.router.navigate(['/login']);
  }

  isLoggedIn(): boolean {
    return !!localStorage.getItem('auth_token');
  }

  getToken(): string {
    return localStorage.getItem('auth_token') || '';
  }

  getCurrentUser(): UserInfo | null {
    return this.currentUserSubject.value;
  }

  getUserRole(): string {
    return this.currentUserSubject.value?.role || 'kunde';
  }

  hasRole(...roles: string[]): boolean {
    const userRole = this.getUserRole();
    return roles.includes(userRole);
  }

  // Legacy compatibility
  getIdToken(): string {
    return this.getToken();
  }

  getUserClaims(): any {
    return this.getCurrentUser();
  }
}
