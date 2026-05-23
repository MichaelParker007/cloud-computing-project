import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

interface ArchiveFolder {
  docId: string;
  archiveId: string;
  name: string;
  provider: string;
  category: string;
}

interface ArchiveFile {
  file_id: string;
  name: string;
  status: string;
  size: number;
  content_type: string;
  selected: boolean;
  formData?: Record<string, string>;
}

const DUMMY_FILES: Omit<ArchiveFile, 'selected'>[] = [
  {
    file_id: 'dummy-1',
    name: 'Versicherungsantrag.pdf',
    status: 'Genehmigt',
    size: 245000,
    content_type: 'application/pdf',
    formData: {
      'Versicherungsnehmer': 'Max Mustermann',
      'Vertragsnummer': 'VN-2024-00184',
      'Versicherungsbeginn': '01.01.2025',
      'Versicherungsende': '31.12.2025',
      'Monatlicher Beitrag': '45,90 EUR',
    },
  },
  {
    file_id: 'dummy-2',
    name: 'Schadenmeldung_2025.pdf',
    status: 'Abgeschickt',
    size: 189000,
    content_type: 'application/pdf',
    formData: {
      'Schadennummer': '',
      'Schadendatum': '15.03.2025',
      'Schadenort': 'München, Hauptstraße 12',
      'Schadenbeschreibung': 'Wasserschaden im Keller durch Rohrbruch',
      'Geschätzte Schadenhöhe': '3.200,00 EUR',
    },
  },
  {
    file_id: 'dummy-3',
    name: 'Beitragsrechnung_Q1_2025.pdf',
    status: 'In Bearbeitung',
    size: 98000,
    content_type: 'application/pdf',
    formData: {
      'Rechnungsnummer': 'RE-2025-0041',
      'Rechnungsdatum': '01.01.2025',
      'Fälligkeitsdatum': '15.01.2025',
      'Betrag': '137,70 EUR',
      'Zahlungsstatus': 'Ausstehend',
    },
  },
  {
    file_id: 'dummy-4',
    name: 'Kuendigungsschreiben.pdf',
    status: 'Nicht angesehen',
    size: 64000,
    content_type: 'application/pdf',
    formData: {
      'Vertragsnummer': 'VN-2024-00184',
      'Kündigungsdatum': '',
      'Kündigungsgrund': '',
      'Wirksamkeit zum': '',
      'Unterschrift': '',
    },
  },
  {
    file_id: 'dummy-5',
    name: 'Vertragsnachtrag_Deckung.pdf',
    status: 'Abgeschickt',
    size: 152000,
    content_type: 'application/pdf',
    formData: {
      'Nachtragsnummer': 'NT-2025-003',
      'Änderungsart': 'Deckungserweiterung',
      'Neue Deckungssumme': '100.000,00 EUR',
      'Gültig ab': '01.04.2025',
      'Zusätzlicher Beitrag': '8,50 EUR / Monat',
    },
  },
];

@Component({
  selector: 'app-archiv',
  imports: [CommonModule, FormsModule],
  templateUrl: './archiv.html',
  styleUrl: './archiv.css',
})
export class Archiv implements OnInit, OnDestroy {
  folders: ArchiveFolder[] = [];
  searchTerm = '';

  selected: ArchiveFolder | null = null;
  currentFolderId: string | null = null;
  files: ArchiveFile[] = [];

  editingFile: ArchiveFile | null = null;
  editFormData: Record<string, string> = {};

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

  get selectedFiles(): ArchiveFile[] {
    return this.files.filter((f) => f.selected);
  }

  get allSelected(): boolean {
    return this.files.length > 0 && this.files.every((f) => f.selected);
  }

  toggleSelectAll(): void {
    const newState = !this.allSelected;
    this.files.forEach((f) => (f.selected = newState));
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

  // ── Navigation ──────────────────────────────────────────────────────
  selectFolder(folder: ArchiveFolder): void {
    this.router.navigate(['/archiv', folder.docId]);
  }

  backToList(): void {
    this.router.navigate(['/archiv']);
  }

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
            next: (f) => {
              this.files = this.mergeDummyFiles(f);
            },
            error: () => {
              this.files = this.makeDummyFiles();
            },
          });
        } else {
          this.currentFolderId = null;
          this.files = this.makeDummyFiles();
        }
      },
      error: () => {
        this.currentFolderId = null;
        this.files = this.makeDummyFiles();
      },
    });
  }

  private makeDummyFiles(): ArchiveFile[] {
    return DUMMY_FILES.map((d) => ({ ...d, selected: false, formData: { ...d.formData } }));
  }

  private mergeDummyFiles(realFiles: any[]): ArchiveFile[] {
    const real: ArchiveFile[] = realFiles.map((f) => ({
      file_id: f.file_id,
      name: f.name,
      status: 'Abgeschickt',
      size: f.size,
      content_type: f.content_type,
      selected: false,
    }));
    const dummies = this.makeDummyFiles();
    return [...dummies, ...real];
  }

  // ── Status ──────────────────────────────────────────────────────────
  statusClass(status: string): string {
    switch (status) {
      case 'Genehmigt': return 'status-genehmigt';
      case 'Abgeschickt': return 'status-abgeschickt';
      case 'In Bearbeitung': return 'status-bearbeitung';
      case 'Nicht angesehen': return 'status-nicht-angesehen';
      default: return '';
    }
  }

  // ── Formular-Editor ─────────────────────────────────────────────────
  openEditor(file: ArchiveFile): void {
    this.editingFile = file;
    this.editFormData = file.formData ? { ...file.formData } : {};
  }

  closeEditor(): void {
    this.editingFile = null;
    this.editFormData = {};
  }

  saveForm(): void {
    if (this.editingFile) {
      this.editingFile.formData = { ...this.editFormData };
      if (this.editingFile.status === 'Nicht angesehen') {
        this.editingFile.status = 'In Bearbeitung';
      }
    }
    this.closeEditor();
  }

  formFields(): string[] {
    return Object.keys(this.editFormData);
  }

  // ── Download ────────────────────────────────────────────────────────
  downloadFile(file: ArchiveFile): void {
    const content = file.formData
      ? Object.entries(file.formData).map(([k, v]) => `${k}: ${v || '—'}`).join('\n')
      : `Datei: ${file.name}`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name.replace('.pdf', '.txt');
    a.click();
    URL.revokeObjectURL(url);
  }

  downloadSelected(): void {
    this.selectedFiles.forEach((f) => this.downloadFile(f));
  }

  // ── Datei-Upload ────────────────────────────────────────────────────
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length || !this.selected) return;
    const file = input.files[0];

    if (this.currentFolderId) {
      this.uploadInto(this.currentFolderId, file, input);
    } else {
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
    if (fileId.startsWith('dummy-')) {
      this.files = this.files.filter((f) => f.file_id !== fileId);
      return;
    }
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
