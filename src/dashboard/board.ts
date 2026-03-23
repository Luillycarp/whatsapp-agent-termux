/**
 * Bull Board — dashboard visual de jobs BullMQ.
 * Accesible en http://localhost:3001/ui
 * Muestra estado de todas las queues: pending, active, completed, failed.
 */

import Fastify from 'fastify';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import { Queue } from 'bullmq';
import { connectionOptions } from '../config/redis.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const PORT = Number(process.env.DASHBOARD_PORT ?? 3001);

// Registrar todas las queues para el dashboard
const queues = [
  new Queue('wa:process-message', connectionOptions),
  new Queue('wa:llm-generate', connectionOptions),
  new Queue('wa:response-sender', connectionOptions),
];

const serverAdapter = new FastifyAdapter();
serverAdapter.setBasePath('/ui');

createBullBoard({
  queues: queues.map((q) => new BullMQAdapter(q)),
  serverAdapter,
});

const app = Fastify({ logger: false });
await app.register(serverAdapter.registerPlugin(), { prefix: '/ui', basePath: '/ui' });

app.get('/', async (_, reply) => {
  return reply.redirect('/ui');
});

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  logger.info(`Bull Board dashboard running at http://localhost:${PORT}/ui`);
} catch (err) {
  logger.error({ err }, 'Failed to start dashboard');
  process.exit(1);
}
