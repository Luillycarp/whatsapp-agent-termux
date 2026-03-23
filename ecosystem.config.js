// PM2 process manager — todos los servicios del agente
export default {
  apps: [
    {
      name: 'baileys',
      script: 'src/gateway/baileys.ts',
      interpreter: 'bun',
      watch: false,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      env: { NODE_ENV: 'production' },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name: 'worker-messages',
      script: 'src/workers/message.worker.ts',
      interpreter: 'bun',
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 2000,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'worker-llm',
      script: 'src/workers/llm.worker.ts',
      interpreter: 'bun',
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 2000,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'dashboard',
      script: 'src/dashboard/board.ts',
      interpreter: 'bun',
      autorestart: true,
      env: { NODE_ENV: 'production' },
    },
  ],
};
