import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-kunden',
  imports: [CommonModule, FormsModule],
  templateUrl: './kunden.html',
  styleUrl: './kunden.css',
})
export class Kunden implements OnInit, OnDestroy {
  clients: any[] = [];
  isLoading = true;
  newClientEmail = '';
  showAssignForm = false;
  message = '';

  private refreshInterval?: ReturnType<typeof setInterval>;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.loadClients();
    this.refreshInterval = setInterval(() => this.loadClients(), 30000);
  }

  ngOnDestroy(): void {
    clearInterval(this.refreshInterval);
  }

  loadClients(): void {
    this.isLoading = true;
    this.api.getBeraterClients().subscribe({
      next: (d) => { this.clients = d; this.isLoading = false; },
      error: () => { this.isLoading = false; },
    });
  }

  assignClient(): void {
    if (!this.newClientEmail.trim()) return;
    this.api.assignClient(this.newClientEmail.trim()).subscribe({
      next: () => {
        this.message = 'Kunde zugewiesen!';
        this.newClientEmail = '';
        this.showAssignForm = false;
        this.loadClients();
        setTimeout(() => (this.message = ''), 3000);
      },
      error: (err) => {
        this.message = err?.error?.detail || 'Fehler beim Zuweisen.';
        setTimeout(() => (this.message = ''), 3000);
      },
    });
  }
}
