import { Injectable } from '@nestjs/common';
import { CustomersRepository } from '../repositories/customers.repository';

@Injectable()
export class CustomersService {
  constructor(private readonly repository: CustomersRepository) {}

  health() {
    return {
      module: 'customers',
      status: 'ok',
      repository: this.repository.name(),
    };
  }
}
