/**
 * Configuración de memoria Mastra con LibSQL.
 * LibSQL escribe en un archivo .db local — sin servidor, compatible Termux.
 * fastembed-js genera embeddings localmente (no requiere API externa).
 */

import { Memory } from '@mastra/memory';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';

const DB_PATH = process.env.MASTRA_DB_PATH ?? './data/mastra.db';

const storage = new LibSQLStore({
  url: `file:${DB_PATH}`,
});

const vector = new LibSQLVector({
  connectionUrl: `file:${DB_PATH}`,
});

export const agentMemory = new Memory({
  storage,
  vector,
  options: {
    // Cuántos mensajes recientes incluir siempre en el contexto
    lastMessages: 20,
    // Búsqueda semántica sobre historial más antiguo
    semanticRecall: {
      topK: 5,
      messageRange: { before: 2, after: 1 },
    },
  },
});
