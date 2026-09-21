import { Injectable } from '@nestjs/common';

@Injectable()
export class SettingsRepository {
  name(): string {
    return 'settings';
  }
}
