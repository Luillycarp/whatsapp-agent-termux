/**
 * Instancia Mastra — punto de entrada para `mastra dev`.
 * Expone el playground en localhost:4111 para testear el agente.
 */

import { Mastra } from '@mastra/core';
import { whatsappAgent } from './agent.js';
import { agentMemory } from './memory.js';

export const mastra = new Mastra({
  agents: { whatsappAgent },
  memory: agentMemory,
});
