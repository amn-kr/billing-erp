import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators';
import { DbService } from '../../common/db.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Public()
  @Get()
  async health() {
    await this.db.$queryRaw`SELECT 1`;
    return { ok: true };
  }
}
