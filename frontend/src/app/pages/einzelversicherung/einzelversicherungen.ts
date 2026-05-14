import { ChangeDetectorRef, Component, NgZone, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-einzelversicherung',
  imports: [CommonModule],
  templateUrl: './einzelversicherung.html',
  styleUrl: './einzelversicherung.css',
})
export class Einzelversicherung implements OnInit {
  versicherung: any = null;
  isLoading = false;
  errorMessage = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient,
    private authService: AuthService,
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.authService.initAuth();

    if (!this.authService.isLoggedIn()) {
      this.router.navigate(['/login']);
      return;
    }

    const id = this.route.snapshot.paramMap.get('id');

    if (!id) {
      this.errorMessage = 'Keine Versicherung ausgewählt.';
      return;
    }

    this.loadVersicherung(id);
  }

  loadVersicherung(id: string): void {
    const token = this.authService.getIdToken();

    if (!token) {
      this.router.navigate(['/login']);
      return;
    }

    const headers = new HttpHeaders({
      Authorization: `Bearer ${token}`,
    });

    this.isLoading = true;

    this.http.get(`/api/versicherungen/${id}`, { headers }).subscribe({
      next: (data) => {
        this.ngZone.run(() => {
          this.versicherung = data;
          this.isLoading = false;
          this.cdr.detectChanges();
        });
      },
      error: () => {
        this.ngZone.run(() => {
          this.errorMessage = 'Versicherung konnte nicht geladen werden.';
          this.isLoading = false;
          this.cdr.detectChanges();
        });
      },
    });
  }

  goBack(): void {
    this.router.navigate(['/versicherungen']);
  }
}