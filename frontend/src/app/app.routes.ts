import { Routes } from '@angular/router';
import { Login } from './pages/login/login';
import { Layout } from './components/layout/layout';
import { Dashboard } from './pages/dashboard/dashboard';
import { Versicherungen } from './pages/versicherungen/versicherungen';
import { Pakete } from './pages/pakete/pakete';
import { Dateien } from './pages/dateien/dateien';
import { Benutzer } from './pages/benutzer/benutzer';
import { Kunden } from './pages/kunden/kunden';
import { authGuard, roleGuard } from './guards/auth.guard';
import { Einzelversicherung } from './pages/einzelversicherung/einzelversicherung';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'login', component: Login },
  {
    path: '',
    component: Layout,
    canActivate: [authGuard],
    children: [
      { path: 'dashboard', component: Dashboard },
      { path: 'versicherungen', component: Versicherungen },
      { path: 'versicherungen/:id', component: Einzelversicherung },
      { path: 'pakete', component: Pakete },
      { path: 'dateien', component: Dateien },
      { path: 'kunden', component: Kunden, canActivate: [roleGuard('admin', 'berater')] },
      { path: 'benutzer', component: Benutzer, canActivate: [roleGuard('admin')] },
    ],
  },
];
