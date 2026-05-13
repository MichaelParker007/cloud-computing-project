import { ChangeDetectorRef, Component, NgZone, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-versicherungen',
  imports: [CommonModule],
  templateUrl: './versicherungen.html',
  styleUrl: './versicherungen.css',
})
export class Versicherungen implements OnInit {
  versicherungen: any[] = [];
  user: any = null;
  isLoading = false;
  errorMessage = '';

  private apiUrl = '/api/versicherungen';
  //private apiUrl = 'http://localhost:8000/versicherungen';
  //vorhin für PAASwar es ='https://project-64e4ee95-be58-4dea-8c0.ey.r.appspot.com/versicherungen';
  // vorhin für IaaS war = 'http://34.185.199.66:5000/versicherungen';

  constructor(
    private router: Router,
    private http: HttpClient,
    private authService: AuthService,
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      await this.authService.initAuth();

      if (!this.authService.isLoggedIn()) {
        this.router.navigate(['/login']);
        return;
      }

      this.user = this.authService.getUserClaims();

      this.loadVersicherungen();
    } catch (error) {
      console.error('Fehler beim Initialisieren der Versicherungsseite:', error);
      this.errorMessage = 'Die Seite konnte nicht geladen werden.';
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  loadVersicherungen(): void {
    const idToken = this.authService.getIdToken();

    if (!idToken) {
      this.router.navigate(['/login']);
      return;
    }

    const headers = new HttpHeaders({
      Authorization: `Bearer ${idToken}`,
    });

    this.isLoading = true;
    this.errorMessage = '';

    this.http.get<any[]>(this.apiUrl, { headers }).subscribe({
      next: (data) => {
        this.ngZone.run(() => {
          console.log('Versicherungen geladen:', data);

          this.versicherungen = data;
          this.isLoading = false;

          this.cdr.detectChanges();
        });
      },
      error: (err) => {
        this.ngZone.run(() => {
          console.error('Fehler beim Laden der Versicherungen:', err);

          this.errorMessage = 'Versicherungen konnten nicht geladen werden.';
          this.versicherungen = [];
          this.isLoading = false;

          this.cdr.detectChanges();
        });
      },
    });
  }

  onLogout(): void {
    this.authService.logout();

    this.versicherungen = [];
    this.user = null;
    this.errorMessage = '';
    this.isLoading = false;

    this.router.navigate(['/login']);
  }
}
