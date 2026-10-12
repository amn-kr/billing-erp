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
import { ImportsController } from './modules/imports/imports.controller';
import { ImportsService } from './modules/imports/imports.service';
import { NumberingService } from './common/numbering.service';
import { LedgerService } from './common/ledger.service';
import { PartiesController } from './modules/parties/parties.controller';
import { PartiesService } from './modules/parties/parties.service';
import { ItemsController } from './modules/items/items.controller';
import { ItemsService } from './modules/items/items.service';
import { BrandsController } from './modules/items/brands.controller';
import { BrandsService } from './modules/items/brands.service';
import { StockController } from './modules/stock/stock.controller';
import { StockService } from './modules/stock/stock.service';
import { PricingController } from './modules/pricing/pricing.controller';
import { PricingService } from './modules/pricing/pricing.service';
import { SettingsController } from './modules/settings/settings.controller';
import { CommissionController } from './modules/commission/commission.controller';
import { CommissionService } from './modules/commission/commission.service';
import { ReportsController } from './modules/reports/reports.controller';
import { ReportsService } from './modules/reports/reports.service';
import { SalesController } from './modules/sales/sales.controller';
import { QuotesController } from './modules/sales/quotes.controller';
import { PurchasesController } from './modules/purchases/purchases.controller';
import { PurchasesService } from './modules/purchases/purchases.service';
import { BankingController } from './modules/banking/banking.controller';
import { BankingService } from './modules/banking/banking.service';
import { ChequesService } from './modules/banking/cheques.service';
import { ExpensesController } from './modules/expenses/expenses.controller';
import { ExpensesService } from './modules/expenses/expenses.service';
import { SalesService } from './modules/sales/sales.service';
import { ReceiptsService } from './modules/sales/receipts.service';
import { BackupController } from './modules/backup/backup.controller';
import { BackupService } from './modules/backup/backup.service';
import { BackupWorker } from './modules/backup/backup.worker';

@Module({
  imports: [
    JwtModule.registerAsync({ global: true, useFactory: () => ({ secret: config().JWT_SECRET }) }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 300 }],
      // Tests create many accounts quickly; throttle.test.ts switches this back on.
      skipIf: () => config().NODE_ENV === 'test' && process.env.TEST_THROTTLE !== '1',
    }),
  ],
  controllers: [AuthController, MeController, BusinessesController, MembersController, AuditController, HealthController, ImportsController,
    PartiesController, ItemsController, BrandsController, StockController, PricingController, SettingsController, CommissionController, SalesController, QuotesController, PurchasesController, BankingController, ExpensesController, ReportsController, BackupController],
  providers: [
    DbService,
    BackupService,
    BackupWorker,
    AuditService,
    TokensService,
    AuthService,
    BusinessesService,
    MembersService,
    ImportsService,
    NumberingService,
    LedgerService,
    BankingService,
    CommissionService,
    ReportsService,
    ChequesService,
    ExpensesService,
    PartiesService,
    ItemsService,
    BrandsService,
    StockService,
    PricingService,
    SalesService,
    ReceiptsService,
    PurchasesService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
