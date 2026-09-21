import { Injectable } from '@nestjs/common';

@Injectable()
export class TaxTypesRepository {
  name(): string {
    return 'tax-types';
  }
}
