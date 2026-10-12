import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { config } from '../../config';
import { BackupService } from './backup.service';

/**
 * Runs the backup sender every minute while the server is awake. The server sleeps after 15
 * idle minutes on the free plan, but nobody can save anything then, so nothing is waiting.
 * Off in tests (they call runDue themselves) and wherever BACKUP_WORKER=off.
 */
@Injectable()
export class BackupWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Backup');
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(private readonly backup: BackupService) {}

  onApplicationBootstrap(): void {
    const c = config();
    if (!(c.BACKUP_WORKER ? c.BACKUP_WORKER === 'on' : c.NODE_ENV !== 'test')) return;
    if (!c.BACKUP_MASTER_KEY) this.log.warn('BACKUP_MASTER_KEY is not set: no backups are sent.');
    this.timers.push(setTimeout(() => void this.tick(), 15_000), setInterval(() => void this.tick(), 60_000));
    for (const t of this.timers) t.unref();
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearTimeout(t);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.backup.runDue();
    } catch (e) {
      this.log.error(`Backup round failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      this.running = false;
    }
  }
}
