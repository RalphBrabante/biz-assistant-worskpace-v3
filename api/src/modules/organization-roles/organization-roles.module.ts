import {All,Controller,Module,Next,Req,Res} from '@nestjs/common';
import type {NextFunction,Request,Response} from 'express';
import {proxyLegacyRoute} from '../legacy/legacy-route-proxy';
@Controller('api/v1/organization-roles')
class OrganizationRolesController {
 @All(['','*']) handle(@Req() req:Request,@Res() res:Response,@Next() next:NextFunction){return proxyLegacyRoute('organization-roles',req,res,next);}
}
@Module({controllers:[OrganizationRolesController]})export class OrganizationRolesModule{}
