import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ThemeService } from '../../core/theme.service';
import { ApiResponse } from '../../core/types';

@Component({
  selector: 'app-verify-email-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './verify-email-page.component.html',
})
export class VerifyEmailPageComponent {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly theme = inject(ThemeService);

  token = '';
  loading = false;
  error = '';
  success = '';

  constructor() {
    this.token = String(this.route.snapshot.queryParamMap.get('token') || '').trim();
    if (this.token) {
      this.verify();
    }
  }

  toggleTheme(): void {
    this.theme.toggle();
  }

  verify(): void {
    if (!this.token) {
      this.error = 'Verification token is required.';
      this.success = '';
      return;
    }

    this.loading = true;
    this.error = '';
    this.success = '';

    this.http
      .post<ApiResponse<unknown>>('/api/v1/auth/verify-email', {
        token: this.token,
      })
      .subscribe({
        next: (response) => {
          this.loading = false;
          this.success = response.message || 'Email verified successfully.';
        },
        error: (errorResponse) => {
          this.loading = false;
          this.error = errorResponse?.error?.message || 'Unable to verify email.';
        },
      });
  }

  goToLogin(): void {
    void this.router.navigate(['/login']);
  }
}
