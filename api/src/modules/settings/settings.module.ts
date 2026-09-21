import { Module } from '@nestjs/common';
import { SettingsController } from './controllers/settings.controller';
import { SettingsService } from './services/settings.service';
import { SettingsRepository } from './repositories/settings.repository';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService, SettingsRepository],
  exports: [SettingsService, SettingsRepository],
})
export class SettingsModule {}
