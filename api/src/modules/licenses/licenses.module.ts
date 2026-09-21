import { Module } from '@nestjs/common';
import { LicensesController } from './controllers/licenses.controller';
import { LicensesService } from './services/licenses.service';
import { LicensesRepository } from './repositories/licenses.repository';

@Module({
  controllers: [LicensesController],
  providers: [LicensesService, LicensesRepository],
  exports: [LicensesService, LicensesRepository],
})
export class LicensesModule {}
