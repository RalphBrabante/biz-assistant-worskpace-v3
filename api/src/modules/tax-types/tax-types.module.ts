import { Module } from '@nestjs/common';
import { TaxTypesController } from './controllers/tax-types.controller';
import { TaxTypesService } from './services/tax-types.service';
import { TaxTypesRepository } from './repositories/tax-types.repository';

@Module({
  controllers: [TaxTypesController],
  providers: [TaxTypesService, TaxTypesRepository],
  exports: [TaxTypesService, TaxTypesRepository],
})
export class TaxTypesModule {}
