import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-dateien',
  imports: [CommonModule, FormsModule],
  templateUrl: './dateien.html',
  styleUrl: './dateien.css',
})
export class Dateien implements OnInit, OnDestroy {
  folders: any[] = [];
  files: any[] = [];
  currentFolderId: string | null = null;
  breadcrumbs: { id: string | null; name: string }[] = [{ id: null, name: 'Hauptverzeichnis' }];
  newFolderName = '';
  showNewFolder = false;
  isLoading = true;
  userRole = '';

  private refreshInterval?: ReturnType<typeof setInterval>;

  constructor(private api: ApiService, private auth: AuthService) {
    this.userRole = auth.getUserRole();
  }

  ngOnInit(): void {
    this.loadContent();
    this.refreshInterval = setInterval(() => this.loadContent(), 30000);
  }

  ngOnDestroy(): void {
    clearInterval(this.refreshInterval);
  }

  get canManage(): boolean {
    return this.userRole === 'admin' || this.userRole === 'berater';
  }

  loadContent(): void {
    this.isLoading = true;
    this.api.getFolders(this.currentFolderId || undefined).subscribe({
      next: (f) => { this.folders = f; },
      error: () => {},
    });
    this.api.getFiles(this.currentFolderId || undefined).subscribe({
      next: (f) => { this.files = f; this.isLoading = false; },
      error: () => { this.isLoading = false; },
    });
  }

  openFolder(folder: any): void {
    this.currentFolderId = folder.folder_id;
    this.breadcrumbs.push({ id: folder.folder_id, name: folder.name });
    this.loadContent();
  }

  navigateTo(index: number): void {
    const crumb = this.breadcrumbs[index];
    this.currentFolderId = crumb.id;
    this.breadcrumbs = this.breadcrumbs.slice(0, index + 1);
    this.loadContent();
  }

  createFolder(): void {
    if (!this.newFolderName.trim()) return;
    this.api.createFolder({
      name: this.newFolderName.trim(),
      parent_id: this.currentFolderId || undefined,
    }).subscribe({
      next: () => {
        this.newFolderName = '';
        this.showNewFolder = false;
        this.loadContent();
      },
    });
  }

  deleteFolder(folderId: string): void {
    if (confirm('Ordner wirklich löschen?')) {
      this.api.deleteFolder(folderId).subscribe({ next: () => this.loadContent() });
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];
    const folderId = this.currentFolderId || 'root';
    this.api.uploadFile(file, folderId).subscribe({
      next: () => { this.loadContent(); input.value = ''; },
      error: (err) => { console.error('Upload fehlgeschlagen:', err); },
    });
  }

  deleteFile(fileId: string): void {
    if (confirm('Datei wirklich löschen?')) {
      this.api.deleteFile(fileId).subscribe({ next: () => this.loadContent() });
    }
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }
}
