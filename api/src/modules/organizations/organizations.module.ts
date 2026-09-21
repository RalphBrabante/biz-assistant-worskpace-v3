import { Module } from '@nestjs/common';
import { OrganizationsController } from './controllers/organizations.controller';
import { OrganizationsService } from './services/organizations.service';
import { OrganizationsRepository } from './repositories/organizations.repository';

@Module({
  controllers: [OrganizationsController],
  providers: [OrganizationsService, OrganizationsRepository],
  exports: [OrganizationsService, OrganizationsRepository],
})
export class OrganizationsModule {}
