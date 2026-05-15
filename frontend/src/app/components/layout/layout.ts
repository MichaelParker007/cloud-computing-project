import { ChangeDetectorRef, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  RouterOutlet,
  RouterLink,
  RouterLinkActive,
  Router,
  NavigationStart,
  NavigationEnd,
  NavigationCancel,
  NavigationError,
} from '@angular/router';
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

  isNavigating = false;
  pageEnter = false;

  constructor(
    private authService: AuthService,
    private router: Router,
    private cdr: ChangeDetectorRef,
  ) {
    this.authService.currentUser$.subscribe((u) => (this.user = u));

    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.isNavigating = true;
        this.pageEnter = false;
        this.cdr.detectChanges();
      } else if (
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel ||
        event instanceof NavigationError
      ) {
        this.isNavigating = false;
        setTimeout(() => {
          this.pageEnter = true;
        }, 0);
      }
    });
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
