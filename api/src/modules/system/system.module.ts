import { Module } from '@nestjs/common';
import { SystemController } from './controllers/system.controller';
import { SystemService } from './services/system.service';
import { SystemRepository } from './repositories/system.repository';

@Module({
  controllers: [SystemController],
  providers: [SystemService, SystemRepository],
  exports: [SystemService, SystemRepository],
})
export class SystemModule {}
