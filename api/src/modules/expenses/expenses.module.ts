import { Module } from '@nestjs/common';
import { ExpensesController } from './controllers/expenses.controller';
import { ExpensesService } from './services/expenses.service';
import { ExpensesRepository } from './repositories/expenses.repository';

@Module({
  controllers: [ExpensesController],
  providers: [ExpensesService, ExpensesRepository],
  exports: [ExpensesService, ExpensesRepository],
})
export class ExpensesModule {}
