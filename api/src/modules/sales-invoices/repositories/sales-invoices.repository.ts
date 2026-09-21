import { Injectable } from '@nestjs/common';

@Injectable()
export class SalesInvoicesRepository {
  name(): string {
    return 'sales-invoices';
  }
}
