import {All,Controller,Module,Next,Req,Res} from '@nestjs/common';
import type {NextFunction,Request,Response} from 'express';
import {proxyLegacyRoute} from '../legacy/legacy-route-proxy';
@Controller('api/v1/cheques')
class ChequesController {
  @All(['','*'])
  handle(@Req() req:Request,@Res() res:Response,@Next() next:NextFunction) {return proxyLegacyRoute('cheques',req,res,next);}
}
@Module({controllers:[ChequesController]})
export class ChequesModule {}
