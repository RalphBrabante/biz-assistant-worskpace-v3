import { ModalDirective } from '../../shared/modal.directive';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ThemeService } from '../../core/theme.service';
import { ApiResponse } from '../../core/types';

interface LoginPayload {
  accessToken?: string;
  requiresOrganizationSelection?: boolean;
  suggestedOrganizationId?: string | null;
  organizations?: LoginOrganizationOption[];
  user?: {
    id?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    profileImageCdnUrl?: string;
    profileImageUrl?: string;
    status?: string;
    organizationId?: string;
    organizationName?: string;
    organizationLegalName?: string;
    currency?: string;
    roleCodes?: string[];
    permissionCodes?: string[];
  };
}

interface LoginOrganizationOption {
  id: string;
  name?: string;
  legalName?: string;
  currency?: string;
  hasActiveLicense?: boolean;
  licenseStatusReason?: string | null;
}

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [ModalDirective, CommonModule, FormsModule, RouterLink],
  templateUrl: './login-page.component.html',
})
export class LoginPageComponent {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  readonly theme = inject(ThemeService);
  private readonly router = inject(Router);

  email = '';
  password = '';
  loading = false;
  error = '';
  forgotEmail = '';
  forgotLoading = false;
  forgotMessage = '';
  forgotError = '';
  forgotModalVisible = false;
  verificationLoading = false;
  verificationMessage = '';
  organizationSelectionVisible = false;
  organizationOptions: LoginOrganizationOption[] = [];
  selectedOrganizationId = '';
  organizationSelectionError = '';

  get canResendVerification(): boolean {
    return String(this.error || '').toLowerCase().includes('not verified');
  }

  toggleTheme(): void {
    this.theme.toggle();
  }

  submit(): void {
    this.organizationSelectionError = '';
    this.organizationSelectionVisible = false;
    this.organizationOptions = [];
    this.selectedOrganizationId = '';
    this.attemptLogin();
  }

  submitWithSelectedOrganization(): void {
    const organizationId = String(this.selectedOrganizationId || '').trim();
    if (!organizationId) {
      this.organizationSelectionError = 'Select an organization to continue.';
      return;
    }
    this.attemptLogin(organizationId);
  }

  closeOrganizationSelectionModal(): void {
    this.organizationSelectionVisible = false;
    this.organizationOptions = [];
    this.selectedOrganizationId = '';
    this.organizationSelectionError = '';
  }

  organizationLabel(organization: LoginOrganizationOption): string {
    return (
      String(organization?.name || '').trim() ||
      String(organization?.legalName || '').trim() ||
      String(organization?.id || '').trim() ||
      '-'
    );
  }

  isOrganizationSelectable(organization: LoginOrganizationOption): boolean {
    return organization?.hasActiveLicense !== false;
  }

  private attemptLogin(organizationId?: string): void {
    this.loading = true;
    this.error = '';
    this.verificationMessage = '';
    this.organizationSelectionError = '';

    const payload: Record<string, unknown> = {
      email: this.email,
      password: this.password,
    };
    const selectedOrganizationId = String(organizationId || '').trim();
    if (selectedOrganizationId) {
      payload['organizationId'] = selectedOrganizationId;
    }

    this.http
      .post<ApiResponse<LoginPayload>>('/api/v1/auth/login', payload, {
        headers: {
          'ngsw-bypass': 'true',
        },
      })
      .subscribe({
        next: (response) => {
          this.loading = false;
          const token = response.data?.accessToken;

          if (!token) {
            this.error = this.toErrorMessage(response?.message, 'Login failed.');
            return;
          }

          this.auth.setSession(token, response.data?.user);
          this.closeOrganizationSelectionModal();
          void this.router.navigate(['/']);
        },
        error: (errorResponse) => {
          this.loading = false;
          const errorCode = String(errorResponse?.error?.code || '').trim().toUpperCase();
          const data = (errorResponse?.error?.data || {}) as LoginPayload;
          if (errorCode === 'ORGANIZATION_SELECTION_REQUIRED' && Array.isArray(data.organizations)) {
            this.organizationSelectionVisible = true;
            this.organizationOptions = data.organizations || [];
            const suggested = String(data.suggestedOrganizationId || '').trim();
            const suggestedAllowed = this.organizationOptions.some(
              (organization) =>
                organization.id === suggested && this.isOrganizationSelectable(organization)
            );
            if (suggestedAllowed) {
              this.selectedOrganizationId = suggested;
            } else {
              const firstEligible = this.organizationOptions.find((organization) =>
                this.isOrganizationSelectable(organization)
              );
              this.selectedOrganizationId = firstEligible?.id || '';
            }
            this.organizationSelectionError = '';
            return;
          }

          if (this.organizationSelectionVisible) {
            this.organizationSelectionError = this.toErrorMessage(
              errorResponse?.error?.message,
              'Unable to continue login with selected organization.'
            );
            return;
          }

          this.error = this.toErrorMessage(errorResponse?.error?.message, 'Unable to log in.');
        },
      });
  }

  openForgotModal(): void {
    this.forgotModalVisible = true;
    this.forgotEmail = this.email || '';
    this.forgotLoading = false;
    this.forgotMessage = '';
    this.forgotError = '';
  }

  closeForgotModal(): void {
    this.forgotModalVisible = false;
  }

  submitForgotPassword(): void {
    const normalizedEmail = String(this.forgotEmail || '').trim().toLowerCase();
    if (!normalizedEmail) {
      this.forgotError = 'Email is required.';
      this.forgotMessage = '';
      return;
    }

    this.forgotLoading = true;
    this.forgotError = '';
    this.forgotMessage = '';

    this.http
      .post<ApiResponse<unknown>>('/api/v1/auth/forgot-password', {
        email: normalizedEmail,
      })
      .subscribe({
        next: (response) => {
          this.forgotLoading = false;
          this.forgotMessage =
            response.message ||
            'If an account exists for that email, a password reset link has been sent.';
        },
        error: (errorResponse) => {
          this.forgotLoading = false;
          this.forgotError = this.toErrorMessage(
            errorResponse?.error?.message,
            'Unable to process password reset request.'
          );
        },
      });
  }

  resendVerificationEmail(): void {
    const normalizedEmail = String(this.email || '').trim().toLowerCase();
    if (!normalizedEmail) {
      this.error = 'Enter your email first to request a verification link.';
      return;
    }

    this.verificationLoading = true;
    this.verificationMessage = '';

    this.http
      .post<ApiResponse<unknown>>('/api/v1/auth/request-email-verification', {
        email: normalizedEmail,
      })
      .subscribe({
        next: (response) => {
          this.verificationLoading = false;
          this.verificationMessage =
            response.message ||
            'If an account exists for that email, a verification link has been sent.';
        },
        error: (errorResponse) => {
          this.verificationLoading = false;
          this.verificationMessage = this.toErrorMessage(
            errorResponse?.error?.message,
            'Unable to send verification email.'
          );
        },
      });
  }

  private toErrorMessage(value: unknown, fallback: string): string {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
    if (value && typeof value === 'object') {
      const fromMessage = (value as { message?: unknown }).message;
      if (typeof fromMessage === 'string' && fromMessage.trim()) {
        return fromMessage;
      }
      try {
        return JSON.stringify(value);
      } catch (_err) {
        return fallback;
      }
    }
    return fallback;
  }
}
