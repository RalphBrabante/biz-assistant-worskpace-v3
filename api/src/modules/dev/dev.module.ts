import { Module } from '@nestjs/common';
import { DevController } from './controllers/dev.controller';
import { DevService } from './services/dev.service';
import { DevRepository } from './repositories/dev.repository';

@Module({
  controllers: [DevController],
  providers: [DevService, DevRepository],
  exports: [DevService, DevRepository],
})
export class DevModule {}
