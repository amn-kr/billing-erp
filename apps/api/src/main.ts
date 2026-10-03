import 'reflect-metadata';
import { config } from './config';
import { createApp } from './app.factory';

async function main() {
  const app = await createApp();
  await app.listen(config().PORT);
}
void main();
