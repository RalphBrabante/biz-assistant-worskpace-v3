import { Injectable } from '@nestjs/common';
import { VendorsRepository } from '../repositories/vendors.repository';

@Injectable()
export class VendorsService {
  constructor(private readonly repository: VendorsRepository) {}

  health() {
    return {
      module: 'vendors',
      status: 'ok',
      repository: this.repository.name(),
    };
  }
}
