import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root',
})
export class ApiService {
  private baseUrl = '/api';

  constructor(
    private http: HttpClient,
    private authService: AuthService,
  ) {}

  private getHeaders(): HttpHeaders {
    return new HttpHeaders({
      Authorization: `Bearer ${this.authService.getToken()}`,
    });
  }

  // Users
  getUsers(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/users`, {
      headers: this.getHeaders(),
    });
  }

  getUser(userId: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/users/${userId}`, {
      headers: this.getHeaders(),
    });
  }

  updateUser(userId: string, data: any): Observable<any> {
    return this.http.put(`${this.baseUrl}/users/${userId}`, data, {
      headers: this.getHeaders(),
    });
  }

  deleteUser(userId: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/users/${userId}`, {
      headers: this.getHeaders(),
    });
  }

  // Berater Clients
  getBeraterClients(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/berater/clients`, {
      headers: this.getHeaders(),
    });
  }

  assignClient(clientEmail: string): Observable<any> {
    return this.http.post(
      `${this.baseUrl}/berater/clients`,
      { client_email: clientEmail },
      { headers: this.getHeaders() },
    );
  }

  // Versicherungen
  getVersicherungen(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/versicherungen`, {
      headers: this.getHeaders(),
    });
  }

  // Packages
  getPackages(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/packages`, {
      headers: this.getHeaders(),
    });
  }

  // Folders
  getFolders(parentId?: string, versicherungId?: string): Observable<any[]> {
    let url = `${this.baseUrl}/folders?`;
    if (parentId) url += `parent_id=${parentId}&`;
    if (versicherungId) url += `versicherung_id=${versicherungId}&`;
    return this.http.get<any[]>(url, { headers: this.getHeaders() });
  }

  createFolder(data: {
    name: string;
    parent_id?: string;
    versicherung_id?: string;
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/folders`, data, {
      headers: this.getHeaders(),
    });
  }

  deleteFolder(folderId: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/folders/${folderId}`, {
      headers: this.getHeaders(),
    });
  }

  // Files
  getFiles(folderId?: string): Observable<any[]> {
    let url = `${this.baseUrl}/files?`;
    if (folderId) url += `folder_id=${folderId}&`;
    return this.http.get<any[]>(url, { headers: this.getHeaders() });
  }

  uploadFile(file: File, folderId: string): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder_id', folderId);
    return this.http.post(`${this.baseUrl}/files/upload`, formData, {
      headers: new HttpHeaders({
        Authorization: `Bearer ${this.authService.getToken()}`,
      }),
    });
  }

  deleteFile(fileId: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/files/${fileId}`, {
      headers: this.getHeaders(),
    });
  }
}
