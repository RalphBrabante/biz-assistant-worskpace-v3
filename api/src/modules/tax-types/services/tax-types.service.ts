import { Injectable } from '@nestjs/common';
import { TaxTypesRepository } from '../repositories/tax-types.repository';

@Injectable()
export class TaxTypesService {
  constructor(private readonly repository: TaxTypesRepository) {}

  health() {
    return {
      module: 'tax-types',
      status: 'ok',
      repository: this.repository.name(),
    };
  }
}
