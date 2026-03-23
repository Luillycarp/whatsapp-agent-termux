/**
 * Gateway Baileys — Conexión WhatsApp con reconexión automática.
 * Optimizado para sobrevivir en Termux (Android mata procesos en background).
 */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  type WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { processIncomingMessage } from '../tasks/index.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

let sock: WASocket | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30_000;

export async function connectToWhatsApp(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version } = await fetchLatestBaileysVersion();

  logger.info({ version }, 'Connecting to WhatsApp...');

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true, // Muestra QR en consola Termux
    logger: pino({ level: 'silent' }), // Silenciar logs internos de Baileys
    browser: ['WhatsApp Agent', 'Termux', '1.0.0'],
    markOnlineOnConnect: false, // Menos batería en mobile
    syncFullHistory: false,
  });

  // Guardar credenciales cuando se actualicen
  sock.ev.on('creds.update', saveCreds);

  // Manejo de conexión con reconexión automática
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      logger.info('Scan el QR con WhatsApp en tu teléfono');
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      logger.warn({ statusCode, shouldReconnect }, 'Connection closed');

      if (shouldReconnect) {
        reconnectAttempts++;
        // Backoff exponencial con cap de 30s — crítico en Termux
        const delay = Math.min(1000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY);
        logger.info({ delay, attempt: reconnectAttempts }, 'Reconnecting...');
        setTimeout(() => connectToWhatsApp(), delay);
      } else {
        logger.error('Logged out from WhatsApp. Delete auth_info/ and restart.');
        process.exit(1);
      }
    }

    if (connection === 'open') {
      reconnectAttempts = 0;
      logger.info('WhatsApp connected successfully');
    }
  });

  // Procesar mensajes entrantes
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      // Ignorar mensajes propios y de estado
      if (msg.key.fromMe) continue;
      if (msg.key.remoteJid === 'status@broadcast') continue;

      const from = msg.key.remoteJid!;
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        '';

      if (!text.trim()) continue;

      logger.info({ from, text: text.slice(0, 50) }, 'Message received');

      // Encolar como DurableTask — fire & forget
      await processIncomingMessage.call({
        from,
        text,
        threadId: from, // JID = ID único de la conversación
        timestamp: Date.now(),
      });
    }
  });
}

// Función para enviar respuesta (usada desde workers)
export async function sendTextMessage(to: string, text: string): Promise<void> {
  if (!sock) throw new Error('WhatsApp socket not initialized');
  await sock.sendMessage(to, { text });
  logger.info({ to, textLen: text.length }, 'Message sent');
}

// Punto de entrada
connectToWhatsApp().catch((err) => {
  logger.error({ err }, 'Fatal error in Baileys gateway');
  process.exit(1);
});
