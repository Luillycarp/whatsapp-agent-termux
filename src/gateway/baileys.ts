/**
 * Gateway Baileys v7.0.0-rc.9
 * Reconexión automática con backoff exponencial — crítico en Termux.
 *
 * BREAKING CHANGES v7 aplicados:
 * - fetchLatestBaileysVersion() reemplazado por fetchWAWebVersion()
 * - JIDs de usuario ahora pueden ser LIDs (formato diferente a PNs)
 * - isJidUser() reemplazado por isPnUser() para PNs
 * - proto.fromObject() → proto.create(), proto.encode/decode
 * - Migrar a LIDs en lugar de restaurar PN JIDs
 *
 * Refs: https://baileys.wiki/docs/migration/to-v7.0.0/
 */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchWAWebVersion,
  isPnUser,
  isLidUser,
  type WASocket,
  type BaileysEventMap,
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

  // v7: fetchWAWebVersion() reemplaza fetchLatestBaileysVersion()
  const { version, isLatest } = await fetchWAWebVersion();
  logger.info({ version, isLatest }, 'Connecting to WhatsApp...');

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: 'silent' }),
    // v7: usar 'Chrome' o 'Safari' — evita fingerprinting de automatización
    browser: ['Chrome (Linux)', '', ''],
    markOnlineOnConnect: false, // Menos batería en mobile
    syncFullHistory: false,
    // v7: habilitar soporte de LIDs (obligatorio en v7)
    // Los LIDs son el nuevo sistema de identidad de WhatsApp
    generateHighQualityLinkPreview: false,
  });

  sock.ev.on('creds.update', saveCreds);

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
        const delay = Math.min(1000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY);
        logger.info({ delay, attempt: reconnectAttempts }, 'Reconnecting...');
        setTimeout(() => connectToWhatsApp(), delay);
      } else {
        logger.error('Logged out. Borrá auth_info/ y reiniciá.');
        process.exit(1);
      }
    }

    if (connection === 'open') {
      reconnectAttempts = 0;
      logger.info('WhatsApp conectado correctamente');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }: BaileysEventMap['messages.upsert']) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (msg.key.remoteJid === 'status@broadcast') continue;

      const jid = msg.key.remoteJid!;

      // v7: los JIDs ahora pueden ser LIDs o PNs
      // isPnUser() para números de teléfono tradicionales
      // isLidUser() para los nuevos LIDs de Meta
      if (!isPnUser(jid) && !isLidUser(jid)) continue;

      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        '';

      if (!text.trim()) continue;

      logger.info({ jid, text: text.slice(0, 50) }, 'Message received');

      await processIncomingMessage.call({
        from: jid,
        text,
        threadId: jid,
        timestamp: Date.now(),
      });
    }
  });
}

export async function sendTextMessage(to: string, text: string): Promise<void> {
  if (!sock) throw new Error('WhatsApp socket no inicializado');
  await sock.sendMessage(to, { text });
  logger.info({ to, textLen: text.length }, 'Mensaje enviado');
}

connectToWhatsApp().catch((err) => {
  logger.error({ err }, 'Error fatal en gateway Baileys');
  process.exit(1);
});
