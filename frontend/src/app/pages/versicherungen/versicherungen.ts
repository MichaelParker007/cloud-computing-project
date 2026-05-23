import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-versicherungen',
  imports: [CommonModule, RouterLink],
  templateUrl: './versicherungen.html',
  styleUrl: './versicherungen.css',
})
export class Versicherungen implements OnInit, OnDestroy {
  meineVersicherungen: any[] = [];
  isLoading = true;
  selectedDetail: any = null;

  private refreshInterval?: ReturnType<typeof setInterval>;

  constructor(
    public router: Router,
    private api: ApiService,
    private authService: AuthService,
  ) {}

  ngOnInit(): void {
    if (!this.authService.isLoggedIn()) {
      this.router.navigate(['/login']);
      return;
    }
    this.loadMeineVersicherungen();
    this.refreshInterval = setInterval(() => this.loadMeineVersicherungen(), 30000);
  }

  ngOnDestroy(): void {
    clearInterval(this.refreshInterval);
  }

  loadMeineVersicherungen(): void {
    this.isLoading = true;
    this.api.getVorschlaege().subscribe({
      next: (data) => {
        this.meineVersicherungen = data.filter((v: any) => v.status === 'angenommen');
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
      },
    });
  }

  openDetail(v: any): void {
    this.selectedDetail = v;
  }

  closeDetail(): void {
    this.selectedDetail = null;
  }
}
