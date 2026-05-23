import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-vorschlaege',
  imports: [CommonModule, FormsModule],
  templateUrl: './vorschlaege.html',
  styleUrl: './vorschlaege.css',
})
export class Vorschlaege implements OnInit, OnDestroy {
  vorschlaege: any[] = [];
  isLoading = true;
  userRole = '';

  // Formular beim Annehmen
  activeId: string | null = null;
  fillForSelf = true;
  formData = {
    vorname: '', nachname: '', geburtsdatum: '',
    strasse: '', plz: '', ort: '',
    telefon: '', email: '', versicherungsbeginn: '',
  };
  signatureData: string | null = null;
  isSubmitting = false;
  formMessage = '';

  // Canvas / Unterschrift
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private isDrawing = false;

  // Ablehnen-Dialog
  declineTargetId: string | null = null;
  declineTargetName = '';

  // Berater: Vorschlag erstellen
  versicherungen: any[] = [];
  clients: any[] = [];
  showCreateForm = false;
  newVorschlag = { versicherung_id: '', kunde_email: '', message: '' };
  createMessage = '';

  private refreshInterval?: ReturnType<typeof setInterval>;

  @ViewChild('signatureCanvas') signatureCanvas?: ElementRef<HTMLCanvasElement>;

  constructor(private api: ApiService, private auth: AuthService) {
    this.userRole = auth.getUserRole();
  }

  ngOnInit(): void {
    this.loadVorschlaege();
    this.refreshInterval = setInterval(() => this.loadVorschlaege(), 30000);
    if (this.canManage) {
      this.api.getVersicherungen().subscribe({ next: (d) => (this.versicherungen = d) });
      this.api.getBeraterClients().subscribe({ next: (d) => (this.clients = d) });
    }
  }

  ngOnDestroy(): void {
    clearInterval(this.refreshInterval);
  }

  get canManage(): boolean {
    return this.userRole === 'admin' || this.userRole === 'berater';
  }

  get offeneVorschlaege(): any[] {
    return this.vorschlaege.filter((v) => v.status === 'offen');
  }

  get angenommeneVorschlaege(): any[] {
    return this.vorschlaege.filter((v) => v.status === 'angenommen');
  }

  get abgelehnteVorschlaege(): any[] {
    return this.vorschlaege.filter((v) => v.status === 'abgelehnt');
  }

  loadVorschlaege(): void {
    this.isLoading = true;
    this.api.getVorschlaege().subscribe({
      next: (d) => { this.vorschlaege = d; this.isLoading = false; },
      error: () => { this.isLoading = false; },
    });
  }

  // ── Vorschlag annehmen (Formular öffnen / schließen) ──────────────────
  toggleForm(vorschlagId: string): void {
    if (this.activeId === vorschlagId) {
      this.activeId = null;
      return;
    }
    this.activeId = vorschlagId;
    this.resetForm();
    setTimeout(() => this.initCanvas(), 50);
  }

  showDeclineDialog(vorschlagId: string, name: string): void {
    this.declineTargetId = vorschlagId;
    this.declineTargetName = name;
  }

  cancelDecline(): void {
    this.declineTargetId = null;
  }

  confirmDecline(): void {
    if (!this.declineTargetId) return;
    this.api.ablehnenVorschlag(this.declineTargetId).subscribe({
      next: () => {
        this.declineTargetId = null;
        this.loadVorschlaege();
      },
    });
  }

  private resetForm(): void {
    this.fillForSelf = true;
    this.formData = {
      vorname: '', nachname: '', geburtsdatum: '',
      strasse: '', plz: '', ort: '',
      telefon: '', email: '', versicherungsbeginn: '',
    };
    this.signatureData = null;
    this.formMessage = '';
  }

  submitForm(): void {
    if (!this.activeId) return;
    if (!this.signatureData) {
      this.formMessage = 'Bitte unterschreiben Sie zuerst.';
      return;
    }
    this.isSubmitting = true;
    this.formMessage = '';
    const payload = this.fillForSelf ? { fuer_mich: true } : this.formData;
    this.api.annehmenVorschlag(this.activeId, {
      form_data: payload,
      signature_data: this.signatureData,
    }).subscribe({
      next: () => {
        this.formMessage = 'Versicherung erfolgreich abgeschlossen!';
        this.isSubmitting = false;
        this.activeId = null;
        this.loadVorschlaege();
      },
      error: () => {
        this.formMessage = 'Fehler beim Absenden. Bitte erneut versuchen.';
        this.isSubmitting = false;
      },
    });
  }

  // ── Canvas / Unterschrift ─────────────────────────────────────────────
  initCanvas(): void {
    const el = this.signatureCanvas?.nativeElement;
    if (!el) return;
    el.width = el.offsetWidth || 600;
    el.height = 200;
    this.canvas = el;
    this.ctx = el.getContext('2d');
    if (this.ctx) {
      this.ctx.strokeStyle = '#1a1a1a';
      this.ctx.lineWidth = 2;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
    }
  }

  startDrawing(e: MouseEvent | TouchEvent): void {
    if (!this.ctx) return;
    this.isDrawing = true;
    const pos = this.getPos(e);
    this.ctx.beginPath();
    this.ctx.moveTo(pos.x, pos.y);
    e.preventDefault();
  }

  draw(e: MouseEvent | TouchEvent): void {
    if (!this.isDrawing || !this.ctx) return;
    const pos = this.getPos(e);
    this.ctx.lineTo(pos.x, pos.y);
    this.ctx.stroke();
    e.preventDefault();
  }

  stopDrawing(): void {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    if (this.canvas) this.signatureData = this.canvas.toDataURL('image/png');
  }

  clearSignature(): void {
    if (this.canvas && this.ctx) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.signatureData = null;
    }
  }

  private getPos(e: MouseEvent | TouchEvent): { x: number; y: number } {
    const c = this.signatureCanvas!.nativeElement;
    const rect = c.getBoundingClientRect();
    const sx = c.width / rect.width;
    const sy = c.height / rect.height;
    if (e instanceof TouchEvent) {
      const t = e.touches[0] || e.changedTouches[0];
      return { x: (t.clientX - rect.left) * sx, y: (t.clientY - rect.top) * sy };
    }
    return { x: ((e as MouseEvent).clientX - rect.left) * sx, y: ((e as MouseEvent).clientY - rect.top) * sy };
  }

  // ── Berater: Vorschlag erstellen ──────────────────────────────────────
  createVorschlag(): void {
    if (!this.newVorschlag.versicherung_id || !this.newVorschlag.kunde_email) return;
    this.api.createVorschlag(this.newVorschlag).subscribe({
      next: () => {
        this.createMessage = 'Vorschlag gesendet!';
        this.newVorschlag = { versicherung_id: '', kunde_email: '', message: '' };
        this.showCreateForm = false;
        this.loadVorschlaege();
        setTimeout(() => (this.createMessage = ''), 3000);
      },
      error: (err) => {
        this.createMessage = err?.error?.detail || 'Fehler beim Senden.';
        setTimeout(() => (this.createMessage = ''), 3000);
      },
    });
  }
}
