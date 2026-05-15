import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService, UserInfo } from '../../services/auth.service';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard implements OnInit, OnDestroy {
  user: UserInfo | null = null;
  stats = { versicherungen: 0, folders: 0, files: 0, users: 0 };

  private refreshInterval?: ReturnType<typeof setInterval>;

  constructor(
    private authService: AuthService,
    private api: ApiService,
  ) {}

  ngOnInit(): void {
    this.user = this.authService.getCurrentUser();
    this.loadStats();
    this.refreshInterval = setInterval(() => this.loadStats(), 30000);
  }

  ngOnDestroy(): void {
    clearInterval(this.refreshInterval);
  }

  get roleName(): string {
    switch (this.user?.role) {
      case 'admin': return 'Administrator';
      case 'berater': return 'Berater';
      default: return 'Kunde';
    }
  }

  loadStats(): void {
    this.api.getVersicherungen().subscribe({
      next: (d) => (this.stats.versicherungen = d.length),
      error: () => {},
    });
    this.api.getFolders().subscribe({
      next: (d) => (this.stats.folders = d.length),
      error: () => {},
    });
    this.api.getFiles().subscribe({
      next: (d) => (this.stats.files = d.length),
      error: () => {},
    });
    if (this.user?.role === 'admin') {
      this.api.getUsers().subscribe({
        next: (d) => (this.stats.users = d.length),
        error: () => {},
      });
    }
  }
}
