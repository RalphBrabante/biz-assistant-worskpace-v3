import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-terms-of-service-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './terms-of-service-page.component.html',
})
export class TermsOfServicePageComponent {
  readonly lastUpdated = 'March 7, 2026';
}

