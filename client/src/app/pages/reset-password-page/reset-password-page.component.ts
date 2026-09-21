import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ThemeService } from '../../core/theme.service';
import { ApiResponse } from '../../core/types';

@Component({
  selector: 'app-reset-password-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './reset-password-page.component.html',
})
export class ResetPasswordPageComponent {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly theme = inject(ThemeService);

  token = '';
  newPassword = '';
  confirmPassword = '';
  loading = false;
  error = '';
  success = '';

  constructor() {
    const queryToken = String(this.route.snapshot.queryParamMap.get('token') || '').trim();
    this.token = queryToken;
  }

  toggleTheme(): void {
    this.theme.toggle();
  }

  submit(): void {
    this.loading = true;
    this.error = '';
    this.success = '';

    this.http
      .post<ApiResponse<unknown>>('/api/v1/auth/reset-password', {
        token: this.token,
        newPassword: this.newPassword,
        confirmPassword: this.confirmPassword,
      })
      .subscribe({
        next: (response) => {
          this.loading = false;
          this.success = response.message || 'Password reset successful.';
          this.newPassword = '';
          this.confirmPassword = '';
        },
        error: (errorResponse) => {
          this.loading = false;
          this.error = errorResponse?.error?.message || 'Unable to reset password.';
        },
      });
  }

  goToLogin(): void {
    void this.router.navigate(['/login']);
  }
}
