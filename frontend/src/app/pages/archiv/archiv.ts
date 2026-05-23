import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

interface ArchiveFolder {
  docId: string;       // Firestore doc_id der Versicherung
  archiveId: string;   // generierte Versicherungs-ID, z.B. "All-123456"
  name: string;        // voller Name der Versicherung
  provider: string;    // Anbieter
  category: string;    // Typ/Kategorie
}

@Component({
  selector: 'app-archiv',
  imports: [CommonModule, FormsModule],
  templateUrl: './archiv.html',
  styleUrl: './archiv.css',
})
export class Archiv implements OnInit, OnDestroy {
  folders: ArchiveFolder[] = [];
  searchTerm = '';

  // Ordner-Ansicht (eine geöffnete Versicherung)
  selected: ArchiveFolder | null = null;
  currentFolderId: string | null = null;
  files: any[] = [];

  isLoading = true;
  userRole = '';

  private routeDocId: string | null = null;
  private paramSub?: Subscription;
  private refreshInterval?: ReturnType<typeof setInterval>;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private route: ActivatedRoute,
    private router: Router,
  ) {
    this.userRole = auth.getUserRole();
  }

  ngOnInit(): void {
    this.paramSub = this.route.paramMap.subscribe((params) => {
      this.routeDocId = params.get('versicherungId');
      this.applyRoute();
    });
    this.loadAll();
    this.refreshInterval = setInterval(() => this.loadAll(), 30000);
  }

  ngOnDestroy(): void {
    this.paramSub?.unsubscribe();
    clearInterval(this.refreshInterval);
  }

  get canManage(): boolean {
    return this.userRole === 'admin' || this.userRole === 'berater';
  }

  get filteredFolders(): ArchiveFolder[] {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) return this.folders;
    return this.folders.filter(
      (f) =>
        f.name.toLowerCase().includes(term) ||
        f.provider.toLowerCase().includes(term) ||
        f.archiveId.toLowerCase().includes(term),
    );
  }

  // ── Laden ────────────────────────────────────────────────────────────
  loadAll(): void {
    this.isLoading = true;
    this.api.getVorschlaege().subscribe({
      next: (vorschlaege) => {
        this.folders = vorschlaege
          .filter((v: any) => v.status === 'angenommen')
          .map((v: any) => this.proposalToFolder(v))
          .sort((a, b) => a.archiveId.localeCompare(b.archiveId));
        this.isLoading = false;
        this.applyRoute();
      },
      error: () => {
        this.isLoading = false;
      },
    });
  }

  /** Reagiert auf den Routen-Parameter: Liste oder geöffneter Ordner. */
  private applyRoute(): void {
    if (!this.routeDocId) {
      this.selected = null;
      return;
    }
    const match = this.folders.find((f) => f.docId === this.routeDocId);
    if (match) {
      this.openFolder(match);
    } else if (this.routeDocId) {
      this.openFolder({
        docId: this.routeDocId,
        archiveId: this.routeDocId.substring(0, 10),
        name: 'Versicherungsordner',
        provider: '',
        category: '',
      });
    }
  }

  private makeArchiveId(provider: string, num: string): string {
    const letters = (provider || '').replace(/[^a-zA-Z]/g, '');
    const prefix = letters
      ? letters.charAt(0).toUpperCase() + letters.slice(1, 3).toLowerCase()
      : 'Ver';
    return `${prefix}-${num}`;
  }

  private proposalToFolder(v: any): ArchiveFolder {
    const digits = v.vorschlag_id.replace(/[^0-9a-f]/gi, '').slice(0, 6).toUpperCase();
    return {
      docId: v.vorschlag_id,
      archiveId: this.makeArchiveId(v.versicherung_provider, digits),
      name: v.versicherung_name,
      provider: v.versicherung_provider,
      category: v.versicherung_category,
    };
  }

  // ── Navigation zwischen Liste und Ordner ──────────────────────────────
  /** Klick auf einen Ordner in der Liste → URL aktualisieren. */
  selectFolder(folder: ArchiveFolder): void {
    this.router.navigate(['/archiv', folder.docId]);
  }

  backToList(): void {
    this.router.navigate(['/archiv']);
  }

  /** Öffnet den Ordner und lädt dessen Dateien (ohne Navigation). */
  private openFolder(folder: ArchiveFolder): void {
    this.selected = folder;
    this.loadFolderFiles(folder.docId);
  }

  private loadFolderFiles(docId: string): void {
    this.api.getFolders(undefined, docId).subscribe({
      next: (folders) => {
        if (folders.length > 0) {
          this.currentFolderId = folders[0].folder_id;
          this.api.getFiles(this.currentFolderId!).subscribe({
            next: (f) => (this.files = f),
            error: () => (this.files = []),
          });
        } else {
          this.currentFolderId = null;
          this.files = [];
        }
      },
      error: () => {
        this.currentFolderId = null;
        this.files = [];
      },
    });
  }

  // ── Datei-Verwaltung ──────────────────────────────────────────────────
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length || !this.selected) return;
    const file = input.files[0];

    if (this.currentFolderId) {
      this.uploadInto(this.currentFolderId, file, input);
    } else {
      // Ordner für diese Versicherung existiert noch nicht → anlegen
      this.api
        .createFolder({ name: this.selected.archiveId, versicherung_id: this.selected.docId })
        .subscribe({
          next: (res: any) => {
            this.currentFolderId = res.folder_id;
            this.uploadInto(res.folder_id, file, input);
          },
          error: (err) => console.error('Ordner konnte nicht angelegt werden:', err),
        });
    }
  }

  private uploadInto(folderId: string, file: File, input: HTMLInputElement): void {
    this.api.uploadFile(file, folderId).subscribe({
      next: () => {
        input.value = '';
        this.loadFolderFiles(this.selected!.docId);
      },
      error: (err) => console.error('Upload fehlgeschlagen:', err),
    });
  }

  deleteFile(fileId: string): void {
    if (confirm('Datei wirklich löschen?')) {
      this.api.deleteFile(fileId).subscribe({
        next: () => this.selected && this.loadFolderFiles(this.selected.docId),
      });
    }
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }
}
