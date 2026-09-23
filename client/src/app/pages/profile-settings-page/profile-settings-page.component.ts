import { CountrySelectComponent } from '../../shared/country-select.component';
import { getBrowserCountry } from '../../shared/countries';
import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';

interface ProfileResponse {
  id?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  profileImageUrl?: string;
  profileImageCdnUrl?: string;
}

@Component({
  selector: 'app-profile-settings-page',
  standalone: true,
  imports: [CountrySelectComponent, CommonModule, FormsModule],
  templateUrl: './profile-settings-page.component.html',
})
export class ProfileSettingsPageComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly confirmDialog = inject(ConfirmDialogService);

  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly error = signal('');
  readonly message = signal('');

  form: Record<string, string> = {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    country: getBrowserCountry(),
    password: '',
    confirmPassword: '',
  };

  selectedFile: File | null = null;
  previewUrl = '';

  get initials(): string {
    const first = String(this.form['firstName'] || '').trim().charAt(0);
    const last = String(this.form['lastName'] || '').trim().charAt(0);
    const email = String(this.form['email'] || '').trim().charAt(0);
    return `${first}${last}`.trim().toUpperCase() || email.toUpperCase() || 'U';
  }

  get displayImageUrl(): string {
    return this.previewUrl || '';
  }

  ngOnInit(): void {
    this.loadProfile();
  }

  loadProfile(): void {
    this.loading.set(true);
    this.error.set('');

    this.api.get<ProfileResponse>('/api/v1/profile').subscribe({
      next: (response) => {
        this.loading.set(false);
        const profile: ProfileResponse = response.data || {};
        this.form = {
          firstName: String(profile.firstName || ''),
          lastName: String(profile.lastName || ''),
          email: String(profile.email || ''),
          phone: String(profile.phone || ''),
          addressLine1: String(profile.addressLine1 || ''),
          addressLine2: String(profile.addressLine2 || ''),
          city: String(profile.city || ''),
          state: String(profile.state || ''),
          postalCode: String(profile.postalCode || ''),
          country: String(profile.country || getBrowserCountry()),
          password: '',
          confirmPassword: '',
        };
        this.previewUrl = String(profile.profileImageCdnUrl || profile.profileImageUrl || '').trim();

        this.auth.updateCurrentUser({
          firstName: profile.firstName,
          lastName: profile.lastName,
          email: profile.email,
          phone: profile.phone,
          addressLine1: profile.addressLine1,
          addressLine2: profile.addressLine2,
          city: profile.city,
          state: profile.state,
          postalCode: profile.postalCode,
          country: profile.country,
          profileImageCdnUrl: profile.profileImageCdnUrl,
          profileImageUrl: profile.profileImageUrl,
        });
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message || 'Unable to load profile settings.');
      },
    });
  }

  onFileSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target?.files?.[0] || null;
    this.selectedFile = file;

    if (!file) {
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    this.previewUrl = objectUrl;
  }

  async saveProfile(): Promise<void> {
    this.error.set('');
    this.message.set('');

    if (!this.form['firstName']?.trim() || !this.form['lastName']?.trim() || !this.form['email']?.trim()) {
      this.error.set('First name, last name, and email are required.');
      return;
    }

    const password = String(this.form['password'] || '').trim();
    const confirmPassword = String(this.form['confirmPassword'] || '').trim();
    if (password && password !== confirmPassword) {
      this.error.set('Password and confirm password do not match.');
      return;
    }

    const confirmed = await this.confirmDialog.confirm({
      title: 'Update Profile',
      message: 'Save your profile changes now?',
      confirmText: 'Update Profile',
      confirmButtonClass: 'ui-btn-primary',
      iconClass: 'bi-person-check',
    });

    if (!confirmed) {
      return;
    }

    const payload = new FormData();
    payload.set('firstName', String(this.form['firstName'] || '').trim());
    payload.set('lastName', String(this.form['lastName'] || '').trim());
    payload.set('email', String(this.form['email'] || '').trim());
    payload.set('phone', String(this.form['phone'] || '').trim());
    payload.set('addressLine1', String(this.form['addressLine1'] || '').trim());
    payload.set('addressLine2', String(this.form['addressLine2'] || '').trim());
    payload.set('city', String(this.form['city'] || '').trim());
    payload.set('state', String(this.form['state'] || '').trim());
    payload.set('postalCode', String(this.form['postalCode'] || '').trim());
    payload.set('country', String(this.form['country'] || '').trim());

    if (password) {
      payload.set('password', password);
    }
    if (this.selectedFile) {
      payload.set('profileImage', this.selectedFile);
    }

    this.submitting.set(true);

    this.api.putFormData<ProfileResponse>('/api/v1/profile', payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        const updated: ProfileResponse = response.data || {};
        this.message.set(response.message || 'Profile updated successfully.');
        this.form['password'] = '';
        this.form['confirmPassword'] = '';
        this.selectedFile = null;
        this.previewUrl = String(updated.profileImageCdnUrl || updated.profileImageUrl || this.previewUrl || '');

        this.auth.updateCurrentUser({
          firstName: updated.firstName,
          lastName: updated.lastName,
          email: updated.email,
          phone: updated.phone,
          addressLine1: updated.addressLine1,
          addressLine2: updated.addressLine2,
          city: updated.city,
          state: updated.state,
          postalCode: updated.postalCode,
          country: updated.country,
          profileImageCdnUrl: updated.profileImageCdnUrl,
          profileImageUrl: updated.profileImageUrl,
        });
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to update profile.');
      },
    });
  }
}
