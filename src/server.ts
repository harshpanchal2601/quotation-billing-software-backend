import { env } from './config/env.js';
import { app } from './app.js';
import { prisma } from './config/database.js';

const server = app.listen(env.PORT, () => {
  console.info(`Buminex API listening on port ${env.PORT}`);
});

async function shutdown(signal: NodeJS.Signals) {
  console.info(`${signal} received. Closing Buminex API server.`);

  server.close(async (error) => {
    await prisma.$disconnect();

    if (error) {
      console.error('Error while closing server.');
      process.exit(1);
    }

    process.exit(0);
  });
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
