import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-versicherungen',
  imports: [CommonModule],
  templateUrl: './versicherungen.html',
  styleUrl: './versicherungen.css',
})
export class Versicherungen implements OnInit {
  versicherungen: any[] = [];
  isLoading = false;
  errorMessage = '';

  constructor(
    private router: Router,
    private api: ApiService,
    private authService: AuthService,
  ) {}

  ngOnInit(): void {
    if (!this.authService.isLoggedIn()) {
      this.router.navigate(['/login']);
      return;
    }
    this.loadVersicherungen();
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
