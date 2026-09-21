import { Injectable } from '@nestjs/common';
import { SettingsRepository } from '../repositories/settings.repository';

@Injectable()
export class SettingsService {
  constructor(private readonly repository: SettingsRepository) {}

  health() {
    return {
      module: 'settings',
      status: 'ok',
      repository: this.repository.name(),
    };
  }
}
