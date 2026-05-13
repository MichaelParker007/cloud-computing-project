import { Injectable } from '@angular/core';
import { OAuthService } from 'angular-oauth2-oidc';
import { authConfig } from '../auth.config';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private initialized = false;

  constructor(private oauthService: OAuthService) {}

  async initAuth(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.oauthService.configure(authConfig);

    await this.oauthService.loadDiscoveryDocumentAndTryLogin();

    this.initialized = true;
  }

  login(): void {
    this.oauthService.initLoginFlow();
  }

  logout(): void {
    this.oauthService.logOut();
    localStorage.clear();
    sessionStorage.clear();
  }

  isLoggedIn(): boolean {
    return this.oauthService.hasValidIdToken();
  }

  getIdToken(): string {
    return this.oauthService.getIdToken();
  }

  getUserClaims(): any {
    return this.oauthService.getIdentityClaims();
  }
}
