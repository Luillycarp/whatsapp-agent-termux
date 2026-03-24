/**
 * Gateway Baileys v6.7.x — PROBADO Y FUNCIONAL
 *
 * Soporta dos métodos de vinculación:
 *   [1] QR Code        — escanear con WhatsApp
 *   [2] Pairing Code  — código de 8 dígitos
 *
 * INTEGRACIÓN:
 * - Mensajes entrantes → BullMQ (processIncomingMessage.call())
 * - Comandos !provider → interceptados aquí antes de encolar
 * - Respuestas de workers → llegan por Redis pub/sub 'wa:send-message'
 *
 * NOTA v7: fetchLatestBaileysVersion() → fetchWAWebVersion()
 *          isJidUser() → isPnUser() / isLidUser()
 *          Ref: https://baileys.wiki/docs/migration/to-v7.0.0/
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import Redis from 'ioredis';
import { processIncomingMessage } from '../tasks/index.js';
import { handleCommand } from './commands.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.join(__dirname, '../../auth');

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

let sock: WASocket | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT = 10;
const MAX_RECONNECT_DELAY = 30_000;

// Suscriptor Redis: recibe respuestas generadas por los workers
const subscriber = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

subscriber.subscribe('wa:send-message', (err) => {
  if (err) logger.error({ err }, 'Error subscribing to wa:send-message');
  else logger.info('Gateway suscrito a canal wa:send-message');
});

subscriber.on('message', async (channel, message) => {
  if (channel !== 'wa:send-message') return;
  try {
    const { to, text } = JSON.parse(message) as { to: string; text: string };
    await sendTextMessage(to, text);
  } catch (err) {
    logger.error({ err }, 'Error procesando mensaje de canal Redis');
  }
});

// ─── Helpers CLI ──────────────────────────────────────────────────────────────

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function chooseMethod(): Promise<'qr' | 'pairing'> {
  console.clear();
  console.log('╔══════════════════════════════════════╗');
  console.log('║        WHATSAPP BOT - SETUP          ║');
  console.log('╠══════════════════════════════════════╣');
  console.log('║  [1] Escanear QR Code                ║');
  console.log('║  [2] Código de 8 dígitos (Pairing)   ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');
  const choice = await ask('Elegí un método [1/2]: ');
  return choice === '2' ? 'pairing' : 'qr';
}

async function getPhoneNumber(): Promise<string> {
  let num = await ask('Ingresá tu número (ej: +5491112345678): ');
  if (!num.startsWith('+')) num = '+' + num;
  return num;
}

// ─── Conexión principal ────────────────────────────────────────────────────────

export async function connectToWhatsApp(
  method: 'qr' | 'pairing' | null = null,
  phoneNumber: string | null = null
): Promise<void> {
  const hasSession = fs.existsSync(AUTH_DIR) && fs.readdirSync(AUTH_DIR).length > 0;

  if (!hasSession && !method) {
    method = await chooseMethod();
    if (method === 'pairing') phoneNumber = await getPhoneNumber();
  } else if (!method) {
    method = 'qr';
  }

  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

  if (!hasSession) {
    console.clear();
    console.log(`\n🔌 Conectando vía ${method === 'pairing' ? 'Pairing Code' : 'QR Code'}...\n`);
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  logger.info({ version: version.join('.'), isLatest }, 'Baileys version');

  sock = makeWASocket({
    version,
    auth: state,
    browser: ['Ubuntu', 'Chrome', '120.0.0.0'],
    connectTimeoutMs: 120_000,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  let pairCodeShown = false;
  let qrShown = false;
  let connected = false;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (method === 'qr' && qr && !qrShown) {
      qrShown = true;
      console.clear();
      console.log('╔══════════════════════════════════════════╗');
      console.log('║         ESCANEÁ EL CÓDIGO QR             ║');
      console.log('╚══════════════════════════════════════════╝\n');
      qrcode.generate(qr, { small: false });
      console.log('\n⏳ Esperando escaneo...\n');
    }

    if (
      method === 'pairing' &&
      connection === 'connecting' &&
      !sock!.authState.creds.registered &&
      !pairCodeShown
    ) {
      pairCodeShown = true;
      try {
        const code = await sock!.requestPairingCode(phoneNumber!.replace('+', ''));
        console.clear();
        console.log('╔══════════════════════════════════════════╗');
        console.log('║           CÓDIGO DE VINCULACIÓN          ║');
        console.log('╠══════════════════════════════════════════╣');
        console.log(`║            👉  ${code}  👈              ║`);
        console.log('╠══════════════════════════════════════════╣');
        console.log('║  WhatsApp > Ajustes > Dispositivos       ║');
        console.log('║  vinculados > Vincular dispositivo       ║');
        console.log('╚══════════════════════════════════════════╝\n');
      } catch (e) {
        logger.error({ err: e }, 'Error al generar pairing code');
      }
    }

    if (connection === 'open') {
      connected = true;
      reconnectAttempts = 0;
      console.clear();
      console.log('╔══════════════════════════════════════════╗');
      console.log('║        ✅  CONECTADO EXITOSAMENTE        ║');
      console.log('╠══════════════════════════════════════════╣');
      console.log(`║  Sesión guardada en: auth/               ║`);
      console.log('║  Escribí !provider help para comandos   ║');
      console.log('╚══════════════════════════════════════════╝\n');
      logger.info('WhatsApp conectado. Escuchando mensajes...');
    }

    if (connection === 'close') {
      if (connected) return;
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      reconnectAttempts++;
      logger.warn({ statusCode, attempt: reconnectAttempts }, 'Conexión cerrada');
      if (statusCode === DisconnectReason.loggedOut) {
        logger.error('Sesión cerrada. Borrá auth/ y reiniciá.');
        process.exit(1);
      }
      if (reconnectAttempts >= MAX_RECONNECT) {
        logger.error('Máximo de reintentos alcanzado.');
        process.exit(1);
      }
      const delay = Math.min(1000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY);
      setTimeout(() => connectToWhatsApp(method, phoneNumber), delay);
    }
  });

  // ── Mensajes entrantes ────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (msg.key.remoteJid === 'status@broadcast') continue;

      const from = msg.key.remoteJid!;
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        '';

      if (!text.trim()) continue;

      // ── Interceptar comandos !provider ────────────────────────────────────
      const commandResponse = handleCommand(text);
      if (commandResponse !== null) {
        await sendTextMessage(from, commandResponse);
        continue; // NO encolar en BullMQ
      }

      // ── Mensaje normal → encolar en BullMQ ──────────────────────────────
      logger.info({ from, preview: text.slice(0, 60) }, 'Mensaje recibido → encolando');
      await processIncomingMessage.call({
        from,
        text,
        threadId: from,
        timestamp: Date.now(),
      });
    }
  });

  if (!hasSession) {
    setTimeout(() => {
      if (!connected) connectToWhatsApp(method, phoneNumber);
    }, 300_000);
  }
}

export async function sendTextMessage(to: string, text: string): Promise<void> {
  if (!sock) throw new Error('Socket WhatsApp no inicializado');
  await sock.sendMessage(to, { text });
  logger.info({ to, len: text.length }, 'Mensaje enviado');
}

connectToWhatsApp().catch((err) => {
  logger.error({ err }, 'Error fatal en gateway Baileys');
  process.exit(1);
});
