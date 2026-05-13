import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService, UserInfo } from '../../services/auth.service';

@Component({
  selector: 'app-layout',
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './layout.html',
  styleUrl: './layout.css',
})
export class Layout {
  sidebarOpen = true;
  user: UserInfo | null = null;

  constructor(private authService: AuthService) {
    this.authService.currentUser$.subscribe((u) => (this.user = u));
  }

  get isAdmin(): boolean {
    return this.user?.role === 'admin';
  }

  get isBerater(): boolean {
    return this.user?.role === 'berater';
  }

  get isKunde(): boolean {
    return this.user?.role === 'kunde';
  }

  get roleName(): string {
    switch (this.user?.role) {
      case 'admin': return 'Administrator';
      case 'berater': return 'Berater';
      default: return 'Kunde';
    }
  }

  toggleSidebar(): void {
    this.sidebarOpen = !this.sidebarOpen;
  }

  onLogout(): void {
    this.authService.logout();
  }
}
