import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { config } from './config';
import { AuthGuard } from './common/auth.guard';
import { AuditService } from './common/audit.service';
import { DbService } from './common/db.service';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { TokensService } from './modules/auth/tokens.service';
import { BusinessesController } from './modules/businesses/businesses.controller';
import { BusinessesService } from './modules/businesses/businesses.service';
import { MeController } from './modules/me/me.controller';
import { MembersController } from './modules/members/members.controller';
import { MembersService } from './modules/members/members.service';
import { AuditController } from './modules/audit/audit.controller';
import { HealthController } from './modules/health/health.controller';

@Module({
  imports: [
    JwtModule.registerAsync({ global: true, useFactory: () => ({ secret: config().JWT_SECRET }) }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 300 }],
      // Tests create many accounts quickly; throttle.test.ts switches this back on.
      skipIf: () => config().NODE_ENV === 'test' && process.env.TEST_THROTTLE !== '1',
    }),
  ],
  controllers: [AuthController, MeController, BusinessesController, MembersController, AuditController, HealthController],
  providers: [
    DbService,
    AuditService,
    TokensService,
    AuthService,
    BusinessesService,
    MembersService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
