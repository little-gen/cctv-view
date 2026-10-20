import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db/pool.js';

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`API escuchando en http://localhost:${config.port}  ·  docs: /api/docs`);
});

async function shutdown() {
  server.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
