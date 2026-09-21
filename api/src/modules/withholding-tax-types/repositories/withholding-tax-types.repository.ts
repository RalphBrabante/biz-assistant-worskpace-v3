import { Injectable } from '@nestjs/common';

@Injectable()
export class WithholdingTaxTypesRepository {
  name(): string {
    return 'withholding-tax-types';
  }
}
