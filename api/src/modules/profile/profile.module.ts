import { Module } from '@nestjs/common';
import { ProfileController } from './controllers/profile.controller';
import { ProfileService } from './services/profile.service';
import { ProfileRepository } from './repositories/profile.repository';

@Module({
  controllers: [ProfileController],
  providers: [ProfileService, ProfileRepository],
  exports: [ProfileService, ProfileRepository],
})
export class ProfileModule {}
