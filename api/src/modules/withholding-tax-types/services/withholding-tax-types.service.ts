import { Injectable } from '@nestjs/common';
import { WithholdingTaxTypesRepository } from '../repositories/withholding-tax-types.repository';

@Injectable()
export class WithholdingTaxTypesService {
  constructor(private readonly repository: WithholdingTaxTypesRepository) {}

  health() {
    return {
      module: 'withholding-tax-types',
      status: 'ok',
      repository: this.repository.name(),
    };
  }
}
