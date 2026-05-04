import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
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

  constructor(
    private router: Router,
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.http.get<any[]>('http://localhost:8000/versicherungen').subscribe((data) => {
      this.versicherungen = data;
      this.cdr.detectChanges();
    });
  }

  onLogout() {
    this.router.navigate(['/login']);
  }
}
