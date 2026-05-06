import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-versicherungen',
  imports: [CommonModule],
  templateUrl: './versicherungen.html',
  styleUrl: './versicherungen.css',
})
export class Versicherungen implements OnInit {
  versicherungen: any[] = [];

  private apiUrl = 'https://project-64e4ee95-be58-4dea-8c0.ey.r.appspot.com/versicherungen'; // vorhin für IaaS war = 'http://34.159.210.74:5000/versicherungen';

  constructor(
    private router: Router,
    private http: HttpClient,
  ) {}

  ngOnInit() {
    this.http.get<any[]>(this.apiUrl).subscribe({
      next: (data) => {
        console.log('Versicherungen geladen:', data);
        this.versicherungen = data;
      },
      error: (err) => {
        console.error('Fehler beim Laden der Versicherungen:', err);
      },
    });
  }

  onLogout() {
    this.router.navigate(['/login']);
  }
}
