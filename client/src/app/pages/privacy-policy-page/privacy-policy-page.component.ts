import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-privacy-policy-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './privacy-policy-page.component.html',
})
export class PrivacyPolicyPageComponent {
  readonly lastUpdated = 'March 7, 2026';
}

