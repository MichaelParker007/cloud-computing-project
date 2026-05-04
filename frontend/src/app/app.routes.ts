import { Routes } from '@angular/router';
import { Login } from './pages/login/login';
import { Versicherungen } from './pages/versicherungen/versicherungen';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'login', component: Login },
  { path: 'versicherungen', component: Versicherungen },
];
