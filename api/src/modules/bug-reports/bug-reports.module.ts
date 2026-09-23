import { Controller, Get, Module, Next, Post, Put, Req, Res } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { proxyLegacyRoute } from '../legacy/legacy-route-proxy';

@Controller('api/v1/bug-reports')
class BugReportsController {
  @Get('board')
  board(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    return proxyLegacyRoute('bug-reports', req, res, next);
  }
  @Post('columns')
  createColumn(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    return proxyLegacyRoute('bug-reports', req, res, next);
  }
  @Get()
  list(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    return proxyLegacyRoute('bug-reports', req, res, next);
  }
  @Post()
  create(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    return proxyLegacyRoute('bug-reports', req, res, next);
  }
  @Put(':id')
  update(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    return proxyLegacyRoute('bug-reports', req, res, next);
  }
}

@Module({controllers: [BugReportsController]})
export class BugReportsModule {}
