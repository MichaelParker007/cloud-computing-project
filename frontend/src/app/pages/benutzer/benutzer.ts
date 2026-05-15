import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-benutzer',
  imports: [CommonModule, FormsModule],
  templateUrl: './benutzer.html',
  styleUrl: './benutzer.css',
})
export class Benutzer implements OnInit, OnDestroy {
  users: any[] = [];
  isLoading = true;
  editingUser: any = null;
  editRole = '';

  private refreshInterval?: ReturnType<typeof setInterval>;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.loadUsers();
    this.refreshInterval = setInterval(() => this.loadUsers(), 30000);
  }

  ngOnDestroy(): void {
    clearInterval(this.refreshInterval);
  }

  loadUsers(): void {
    this.isLoading = true;
    this.api.getUsers().subscribe({
      next: (data) => { this.users = data; this.isLoading = false; },
      error: () => { this.isLoading = false; },
    });
  }

  startEdit(user: any): void {
    this.editingUser = user;
    this.editRole = user.role;
  }

  saveRole(): void {
    if (!this.editingUser) return;
    this.api.updateUser(this.editingUser.user_id, { role: this.editRole }).subscribe({
      next: () => { this.editingUser = null; this.loadUsers(); },
    });
  }

  cancelEdit(): void {
    this.editingUser = null;
  }

  deleteUser(userId: string): void {
    if (confirm('Benutzer wirklich löschen?')) {
      this.api.deleteUser(userId).subscribe({ next: () => this.loadUsers() });
    }
  }

  getRoleBadgeClass(role: string): string {
    return `role-${role}`;
  }
}
