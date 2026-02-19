import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { environment } from './environments/environment';
import { Tests } from './app/services/tests';

bootstrapApplication(App, appConfig)
	.then((appRef) => {
		if (!environment.production) {
			appRef.injector.get(Tests).run();
		}
	})
	.catch((err) => console.error(err));
