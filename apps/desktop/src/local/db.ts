/**
 * The shop's own PostgreSQL 16 in single-PC mode: made in <userData>/local/pgdata on first start,
 * started with the app, stopped cleanly when the app closes. Only this computer can reach it
 * (127.0.0.1, password required). After a crash or power cut PostgreSQL repairs itself on the next start.
 * pg_ctl starts it (on Windows it also drops administrator rights, which PostgreSQL requires).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface DbOptions {
  /** folder with bin/, lib/, share/ (scripts/ensure-postgres.cjs, or resources/postgres when installed) */
  pgDir: string;
  /** <userData>/local */
  root: string;
}

const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name);

/** Run a PostgreSQL program and wait for it to finish; its output goes to the log file. */
function run(o: DbOptions, program: string, args: string[], log: string): Promise<number> {
  return new Promise((done, fail) => {
    const out = fs.openSync(log, 'a');
    // no pipes: pg_ctl's server keeps running after pg_ctl ends and would hold them open
    const p = spawn(path.join(o.pgDir, 'bin', exe(program)), args, { stdio: ['ignore', out, out], windowsHide: true, env: { ...process.env, LC_ALL: 'C', LANG: 'C' } });
    p.on('error', (e) => { fs.closeSync(out); fail(e); });
    p.on('exit', (code) => { fs.closeSync(out); done(code ?? 1); });
  });
}

export class LocalDatabase {
  readonly data: string;
  readonly log: string;
  port = 0;

  constructor(private o: DbOptions) {
    this.data = path.join(o.root, 'pgdata');
    this.log = path.join(o.root, 'postgres.log');
  }

  exists() {
    return fs.existsSync(path.join(this.data, 'PG_VERSION'));
  }

  /** First start: make the database files, with a password for the superuser. */
  async create(adminPassword: string) {
    if (this.exists()) return;
    fs.mkdirSync(this.o.root, { recursive: true });
    // a half-made folder from an interrupted first start is made again
    fs.rmSync(this.data, { recursive: true, force: true });
    const pw = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'billing-pg-')), 'pw');
    fs.writeFileSync(pw, adminPassword, { mode: 0o600 });
    try {
      const code = await run(this.o, 'initdb', ['-D', this.data, '-U', 'postgres', '-A', 'scram-sha-256', `--pwfile=${pw}`, '-E', 'UTF8', '--locale=C', '--no-instructions'], this.log);
      if (code !== 0 || !this.exists()) throw new Error(`Could not make the database (initdb ended with ${code}); see ${this.log}`);
    } finally {
      fs.rmSync(path.dirname(pw), { recursive: true, force: true });
    }
  }

  async running(): Promise<boolean> {
    return (await run(this.o, 'pg_ctl', ['status', '-D', this.data], this.log)) === 0;
  }

  async start(port: number) {
    // still running from a crash of the app: stop it first, so it starts on this port
    if (await this.running()) await this.stop();
    const opts = `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories= -c max_connections=30`;
    const code = await run(this.o, 'pg_ctl', ['start', '-D', this.data, '-w', '-t', '120', '-l', this.log, '-o', opts], this.log);
    if (code !== 0) throw new Error(`The database did not start (pg_ctl ended with ${code}); see ${this.log}`);
    this.port = port;
  }

  /** Clean stop: everything written is on disk. */
  async stop() {
    await run(this.o, 'pg_ctl', ['stop', '-D', this.data, '-m', 'fast', '-w', '-t', '60'], this.log);
    this.port = 0;
  }

  /**
   * Copy of the stopped database before an app update changes it, in <root>/backups/<name>.
   * The newest `keep` copies are kept.
   */
  backup(name: string, keep = 3): string {
    const dir = path.join(this.o.root, 'backups');
    const to = path.join(dir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.cpSync(this.data, to + '.tmp', { recursive: true });
    fs.renameSync(to + '.tmp', to);
    const all = fs.readdirSync(dir).filter((f) => !f.endsWith('.tmp')).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const { f } of all.slice(keep)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
    return to;
  }
}
