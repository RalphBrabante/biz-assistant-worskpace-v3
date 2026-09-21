import { Module } from '@nestjs/common';
import { VendorsController } from './controllers/vendors.controller';
import { VendorsService } from './services/vendors.service';
import { VendorsRepository } from './repositories/vendors.repository';

@Module({
  controllers: [VendorsController],
  providers: [VendorsService, VendorsRepository],
  exports: [VendorsService, VendorsRepository],
})
export class VendorsModule {}
