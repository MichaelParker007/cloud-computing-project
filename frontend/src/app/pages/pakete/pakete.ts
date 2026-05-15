import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-pakete',
  imports: [CommonModule],
  templateUrl: './pakete.html',
  styleUrl: './pakete.css',
})
export class Pakete implements OnInit, OnDestroy {
  packages: any[] = [];
  isLoading = true;

  private refreshInterval?: ReturnType<typeof setInterval>;

  constructor(private api: ApiService, private auth: AuthService) {}

  ngOnInit(): void {
    this.loadPackages();
    this.refreshInterval = setInterval(() => this.loadPackages(), 30000);
  }

  ngOnDestroy(): void {
    clearInterval(this.refreshInterval);
  }

  loadPackages(): void {
    this.api.getPackages().subscribe({
      next: (data) => { this.packages = data; this.isLoading = false; },
      error: () => { this.isLoading = false; },
    });
  }

  getTierClass(tier: string): string {
    return `tier-${tier}`;
  }

  getTierIcon(tier: string): string {
    switch (tier) {
      case 'basic': return '🥉';
      case 'komfort': return '🥈';
      case 'premium': return '🥇';
      default: return '📦';
    }
  }
}
