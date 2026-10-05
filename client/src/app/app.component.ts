import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/theme.service';
import { NavigationLoadingService } from './core/navigation-loading.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet></router-outlet>',
})
export class AppComponent {
  constructor(theme: ThemeService, _navigation: NavigationLoadingService) {
    theme.init();
  }
}
