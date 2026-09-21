import { Module } from '@nestjs/common';
import { WithholdingTaxTypesController } from './controllers/withholding-tax-types.controller';
import { WithholdingTaxTypesService } from './services/withholding-tax-types.service';
import { WithholdingTaxTypesRepository } from './repositories/withholding-tax-types.repository';

@Module({
  controllers: [WithholdingTaxTypesController],
  providers: [WithholdingTaxTypesService, WithholdingTaxTypesRepository],
  exports: [WithholdingTaxTypesService, WithholdingTaxTypesRepository],
})
export class WithholdingTaxTypesModule {}
