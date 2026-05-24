import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService, UserInfo } from '../../services/auth.service';
import { ApiService } from '../../services/api.service';

export interface ActivityItem {
  type: 'vorschlag_neu' | 'vorschlag_aktualisiert' | 'versicherung_aktiviert' | 'vorschlag_abgelehnt' | 'dokument_neu' | 'ordner_neu';
  icon: string;
  title: string;
  detail: string;
  date: Date;
  routerLink?: string;
}

export interface CostItem {
  name: string;
  provider: string;
  monthly: number;
}

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard implements OnInit, OnDestroy {
  user: UserInfo | null = null;
  activities: ActivityItem[] = [];
  activitiesLoading = true;
  costItems: CostItem[] = [];
  costTotal = 0;
  costsLoading = true;

  private refreshInterval?: ReturnType<typeof setInterval>;

  constructor(
    private authService: AuthService,
    private api: ApiService,
  ) {}

  ngOnInit(): void {
    this.user = this.authService.getCurrentUser();
    this.loadActivities();
    this.loadCosts();
    this.refreshInterval = setInterval(() => {
      this.loadActivities();
      this.loadCosts();
    }, 30000);
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

  loadCosts(): void {
    this.costsLoading = true;
    this.api.getVorschlaege().subscribe({
      next: (vorschlaege) => {
        this.costItems = vorschlaege
          .filter((v: any) => v.status === 'angenommen')
          .map((v: any) => ({
            name: v.versicherung_name || 'Versicherung',
            provider: v.versicherung_provider || '',
            monthly: v.versicherung_price || 0,
          }));
        this.costTotal = this.costItems.reduce((sum, item) => sum + item.monthly, 0);
        this.costsLoading = false;
      },
      error: () => { this.costsLoading = false; },
    });
  }

  loadActivities(): void {
    this.activitiesLoading = true;
    const items: ActivityItem[] = [];
    let pending = 3;

    const finalize = () => {
      pending--;
      if (pending <= 0) {
        items.sort((a, b) => b.date.getTime() - a.date.getTime());
        this.activities = items.slice(0, 20);
        this.activitiesLoading = false;
      }
    };

    this.api.getVorschlaege().subscribe({
      next: (vorschlaege) => {
        for (const v of vorschlaege) {
          if (v.status === 'angenommen') {
            items.push({
              type: 'versicherung_aktiviert',
              icon: '✅',
              title: `Versicherung aktiviert`,
              detail: v.versicherung_name || 'Versicherung',
              date: new Date(v.submitted_at || v.created_at),
              routerLink: '/versicherungen',
            });
          } else if (v.status === 'offen') {
            items.push({
              type: 'vorschlag_neu',
              icon: '💡',
              title: `Neuer Vorschlag`,
              detail: v.versicherung_name || 'Versicherung',
              date: new Date(v.created_at),
              routerLink: '/vorschlaege',
            });
          } else if (v.status === 'abgelehnt') {
            items.push({
              type: 'vorschlag_abgelehnt',
              icon: '❌',
              title: `Vorschlag abgelehnt`,
              detail: v.versicherung_name || 'Versicherung',
              date: new Date(v.created_at),
            });
          }
        }
        finalize();
      },
      error: () => finalize(),
    });

    this.api.getFiles().subscribe({
      next: (files) => {
        for (const f of files) {
          items.push({
            type: 'dokument_neu',
            icon: '📄',
            title: `Neues Dokument`,
            detail: f.name || 'Datei',
            date: new Date(f.created_at),
            routerLink: '/archiv',
          });
        }
        finalize();
      },
      error: () => finalize(),
    });

    this.api.getFolders().subscribe({
      next: (folders) => {
        for (const f of folders) {
          items.push({
            type: 'ordner_neu',
            icon: '📁',
            title: `Neuer Ordner`,
            detail: f.name || 'Ordner',
            date: new Date(f.created_at),
            routerLink: '/archiv',
          });
        }
        finalize();
      },
      error: () => finalize(),
    });
  }

  formatDate(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Gerade eben';
    if (minutes < 60) return `vor ${minutes} Min.`;
    if (hours < 24) return `vor ${hours} Std.`;
    if (days < 7) return `vor ${days} Tag${days > 1 ? 'en' : ''}`;
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
}
