import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-kunden',
  imports: [CommonModule, FormsModule],
  templateUrl: './kunden.html',
  styleUrl: './kunden.css',
})
export class Kunden implements OnInit {
  clients: any[] = [];
  isLoading = true;
  newClientEmail = '';
  showAssignForm = false;
  message = '';

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.loadClients();
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
