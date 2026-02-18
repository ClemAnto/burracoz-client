import { Routes } from '@angular/router';

export const routes: Routes = [
	{
		path: '',
		loadComponent: () => import('./ui/stage/stage').then((c) => c.Stage),
	},
	{
		path: '**',
		redirectTo: '',
	},
];
