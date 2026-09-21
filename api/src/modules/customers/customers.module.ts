import { Module } from '@nestjs/common';
import { CustomersController } from './controllers/customers.controller';
import { CustomersService } from './services/customers.service';
import { CustomersRepository } from './repositories/customers.repository';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, CustomersRepository],
  exports: [CustomersService, CustomersRepository],
})
export class CustomersModule {}
