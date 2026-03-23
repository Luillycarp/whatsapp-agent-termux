import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const datetimeTool = createTool({
  id: 'get-datetime',
  description: 'Obtiene la fecha y hora actual del servidor',
  inputSchema: z.object({
    timezone: z.string().optional().describe('Timezone IANA, ej: America/Argentina/Buenos_Aires'),
  }),
  outputSchema: z.object({
    iso: z.string(),
    human: z.string(),
    timezone: z.string(),
  }),
  execute: async ({ context }) => {
    const tz = context.timezone ?? 'America/Argentina/Buenos_Aires';
    const now = new Date();
    return {
      iso: now.toISOString(),
      human: now.toLocaleString('es-AR', { timeZone: tz }),
      timezone: tz,
    };
  },
});
