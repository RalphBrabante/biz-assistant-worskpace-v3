import { Module } from '@nestjs/common';
import { SalesInvoicesController } from './controllers/sales-invoices.controller';
import { SalesInvoicesService } from './services/sales-invoices.service';
import { SalesInvoicesRepository } from './repositories/sales-invoices.repository';

@Module({
  controllers: [SalesInvoicesController],
  providers: [SalesInvoicesService, SalesInvoicesRepository],
  exports: [SalesInvoicesService, SalesInvoicesRepository],
})
export class SalesInvoicesModule {}
