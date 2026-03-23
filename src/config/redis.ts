import { Redis } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

// Conexión compartida para producers (BullMQ requiere instancias separadas)
export const redisConnection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null, // requerido por BullMQ
  enableReadyCheck: false,
  lazyConnect: true,
});

// Conexión de solo lectura para subscribers
export const redisSubscriber = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
});

export const connectionOptions = {
  connection: redisConnection,
};
