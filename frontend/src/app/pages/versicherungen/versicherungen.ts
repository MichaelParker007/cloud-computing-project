import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-versicherungen',
  imports: [CommonModule],
  templateUrl: './versicherungen.html',
  styleUrl: './versicherungen.css',
})
export class Versicherungen implements OnInit, OnDestroy {
  versicherungen: any[] = [];
  isLoading = false;
  errorMessage = '';

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
    this.loadVersicherungen();
    this.refreshInterval = setInterval(() => this.loadVersicherungen(), 30000);
  }

  ngOnDestroy(): void {
    clearInterval(this.refreshInterval);
  }

  loadVersicherungen(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.api.getVersicherungen().subscribe({
      next: (data) => {
        this.versicherungen = data;
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Fehler beim Laden der Versicherungen:', err);
        this.errorMessage = 'Versicherungen konnten nicht geladen werden.';
        this.versicherungen = [];
        this.isLoading = false;
      },
    });
  }
}
