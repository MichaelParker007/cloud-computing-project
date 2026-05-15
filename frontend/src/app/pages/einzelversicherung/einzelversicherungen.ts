import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, Subscription } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-einzelversicherung',
  imports: [CommonModule, FormsModule],
  templateUrl: './einzelversicherung.html',
  styleUrl: './einzelversicherung.css',
})
export class Einzelversicherung implements OnInit, OnDestroy {
  versicherung: any = null;
  isLoading = false;
  errorMessage = '';
  versicherungId: string | null = null;

  // Form editor state (Kunde)
  showFormEditor = false;
  formStatus = '';
  formId: string | null = null;
  isSaving = false;
  isSubmitting = false;
  formMessage = '';
  signatureData: string | null = null;

  formData = {
    vorname: '',
    nachname: '',
    geburtsdatum: '',
    strasse: '',
    plz: '',
    ort: '',
    telefon: '',
    email: '',
    versicherungsbeginn: '',
  };

  // Berater: list of all submissions
  formSubmissions: any[] = [];
  selectedSubmission: any = null;

  // Canvas / signature state
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private isDrawing = false;

  private routeSub?: Subscription;
  private refreshInterval?: ReturnType<typeof setInterval>;

  @ViewChild('signatureCanvas') signatureCanvas?: ElementRef<HTMLCanvasElement>;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient,
    private authService: AuthService,
    private api: ApiService,
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.authService.initAuth();

    if (!this.authService.isLoggedIn()) {
      this.router.navigate(['/login']);
      return;
    }

    this.routeSub = this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (!id) {
        this.errorMessage = 'Keine Versicherung ausgewählt.';
        return;
      }

      if (id !== this.versicherungId) {
        this.resetState();
        this.versicherungId = id;
        this.startRefresh(id);
      }
    });
  }

  private resetState(): void {
    this.versicherung = null;
    this.errorMessage = '';
    this.showFormEditor = false;
    this.formStatus = '';
    this.formId = null;
    this.formMessage = '';
    this.signatureData = null;
    this.formSubmissions = [];
    this.selectedSubmission = null;
    this.formData = {
      vorname: '', nachname: '', geburtsdatum: '',
      strasse: '', plz: '', ort: '',
      telefon: '', email: '', versicherungsbeginn: '',
    };
    this.clearRefreshInterval();
  }

  private startRefresh(id: string): void {
    this.loadVersicherung(id);
    this.loadFormulare(id);
    this.clearRefreshInterval();
    this.refreshInterval = setInterval(() => {
      this.loadVersicherung(id);
      this.loadFormulare(id);
    }, 30000);
  }

  private clearRefreshInterval(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
    }
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
    this.clearRefreshInterval();
  }

  get userRole(): string {
    return this.authService.getUserRole();
  }

  isKunde(): boolean {
    return this.userRole === 'kunde';
  }

  isBerater(): boolean {
    return this.userRole === 'berater' || this.userRole === 'admin';
  }

  isSubmitted(): boolean {
    return this.formStatus === 'abgeschickt' || this.formStatus === 'bearbeitet';
  }

  getStatusLabel(status?: string): string {
    switch (status ?? this.formStatus) {
      case 'offen': return 'Offen';
      case 'abgeschickt': return 'Abgeschickt';
      case 'bearbeitet': return 'Bearbeitet';
      default: return '';
    }
  }

  getFormFields(data: any): { key: string; label: string; value: string }[] {
    if (!data) return [];
    const labels: Record<string, string> = {
      vorname: 'Vorname',
      nachname: 'Nachname',
      geburtsdatum: 'Geburtsdatum',
      strasse: 'Straße & Hausnummer',
      plz: 'PLZ',
      ort: 'Ort',
      telefon: 'Telefon',
      email: 'E-Mail',
      versicherungsbeginn: 'Versicherungsbeginn',
    };
    return Object.entries(labels).map(([key, label]) => ({
      key,
      label,
      value: data[key] || '',
    }));
  }

  loadVersicherung(id: string): void {
    const token = this.authService.getIdToken();
    if (!token) {
      this.router.navigate(['/login']);
      return;
    }
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
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

  loadFormulare(id: string): void {
    this.api.getFormulare(id).subscribe({
      next: (data) => {
        this.ngZone.run(() => {
          if (this.isKunde()) {
            if (data.length > 0) {
              const sub = data[0];
              this.formId = sub.form_id;
              this.formStatus = sub.status;
              this.loadFormularDetail(id, sub.form_id);
            }
          } else {
            this.formSubmissions = data;
          }
          this.cdr.detectChanges();
        });
      },
      error: () => {},
    });
  }

  loadFormularDetail(versicherungId: string, formId: string): void {
    this.api.getFormularDetail(versicherungId, formId).subscribe({
      next: (data) => {
        this.ngZone.run(() => {
          if (data.form_data) {
            this.formData = { ...this.formData, ...data.form_data };
          }
          if (data.signature_data) {
            this.signatureData = data.signature_data;
          }
          this.formStatus = data.status;
          this.cdr.detectChanges();
        });
      },
      error: () => {},
    });
  }

  openFormEditor(): void {
    this.showFormEditor = !this.showFormEditor;
    if (this.showFormEditor && !this.isSubmitted()) {
      setTimeout(() => this.initCanvas(), 50);
    }
  }

  initCanvas(): void {
    const canvasEl = this.signatureCanvas?.nativeElement;
    if (!canvasEl) return;
    canvasEl.width = canvasEl.offsetWidth || 600;
    canvasEl.height = 140;
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    if (this.ctx) {
      this.ctx.strokeStyle = '#1a1a1a';
      this.ctx.lineWidth = 2;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
    }
    if (this.signatureData) {
      const img = new Image();
      img.onload = () => this.ctx?.drawImage(img, 0, 0);
      img.src = this.signatureData;
    }
  }

  startDrawing(e: MouseEvent | TouchEvent): void {
    if (this.isSubmitted() || !this.ctx) return;
    this.isDrawing = true;
    const pos = this.getCanvasPos(e);
    this.ctx.beginPath();
    this.ctx.moveTo(pos.x, pos.y);
    e.preventDefault();
  }

  draw(e: MouseEvent | TouchEvent): void {
    if (!this.isDrawing || !this.ctx) return;
    const pos = this.getCanvasPos(e);
    this.ctx.lineTo(pos.x, pos.y);
    this.ctx.stroke();
    e.preventDefault();
  }

  stopDrawing(): void {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    if (this.canvas) {
      this.signatureData = this.canvas.toDataURL('image/png');
    }
  }

  getCanvasPos(e: MouseEvent | TouchEvent): { x: number; y: number } {
    const canvas = this.signatureCanvas!.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if (e instanceof TouchEvent) {
      const touch = e.touches[0] || e.changedTouches[0];
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      };
    }
    return {
      x: ((e as MouseEvent).clientX - rect.left) * scaleX,
      y: ((e as MouseEvent).clientY - rect.top) * scaleY,
    };
  }

  clearSignature(): void {
    if (this.canvas && this.ctx) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.signatureData = null;
    }
  }

  async saveForm(): Promise<void> {
    if (!this.versicherungId) return;
    this.isSaving = true;
    this.formMessage = '';
    try {
      const result = await firstValueFrom(
        this.api.saveFormular(this.versicherungId, {
          form_data: this.formData,
          signature_data: this.signatureData,
        }),
      );
      this.formId = result.form_id;
      this.formStatus = result.status;
      this.formMessage = 'Formular gespeichert.';
    } catch {
      this.formMessage = 'Fehler beim Speichern. Bitte erneut versuchen.';
    } finally {
      this.isSaving = false;
      this.cdr.detectChanges();
    }
  }

  async submitForm(): Promise<void> {
    if (!this.versicherungId) return;
    this.isSubmitting = true;
    this.formMessage = '';
    try {
      const saveResult = await firstValueFrom(
        this.api.saveFormular(this.versicherungId, {
          form_data: this.formData,
          signature_data: this.signatureData,
        }),
      );
      this.formId = saveResult.form_id;
      const submitResult = await firstValueFrom(
        this.api.submitFormular(this.versicherungId, this.formId!),
      );
      this.formStatus = submitResult.status;
      this.formMessage = 'Formular erfolgreich abgeschickt!';
    } catch {
      this.formMessage = 'Fehler beim Abschicken. Bitte erneut versuchen.';
    } finally {
      this.isSubmitting = false;
      this.cdr.detectChanges();
    }
  }

  viewSubmission(sub: any): void {
    if (this.selectedSubmission?.form_id === sub.form_id) {
      this.selectedSubmission = null;
      return;
    }
    this.api.getFormularDetail(this.versicherungId!, sub.form_id).subscribe({
      next: (data) => {
        this.ngZone.run(() => {
          this.selectedSubmission = data;
          const idx = this.formSubmissions.findIndex((f) => f.form_id === sub.form_id);
          if (idx >= 0) this.formSubmissions[idx].status = data.status;
          this.cdr.detectChanges();
        });
      },
    });
  }

  goBack(): void {
    this.router.navigate(['/versicherungen']);
  }
}
