import { Injectable } from '@nestjs/common';
import { SalesInvoicesRepository } from '../repositories/sales-invoices.repository';

@Injectable()
export class SalesInvoicesService {
  constructor(private readonly repository: SalesInvoicesRepository) {}

  health() {
    return {
      module: 'sales-invoices',
      status: 'ok',
      repository: this.repository.name(),
    };
  }
}
