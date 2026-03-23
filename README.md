# whatsapp-agent-termux

WhatsApp AI Agent diseñado para correr en **Termux/Android (ARM64)** sin Docker.

Replica la DX de trigger.dev usando BullMQ + DurableTask pattern, con Baileys como capa WhatsApp y Mastra como cerebro del agente.

## Stack

| Capa | Tecnología |
|---|---|
| WhatsApp | Baileys (WebSocket nativo) |
| Cola durable | BullMQ + Redis |
| Agente IA | Mastra (Agent + Memory + Tools) |
| LLM | Groq (cloud) / Ollama (local) |
| Memoria | LibSQL (archivo local) + fastembed |
| Dashboard jobs | Bull Board (`localhost:3001/ui`) |
| Playground agente | Mastra Dev (`localhost:4111`) |
| Process manager | PM2 |

## Arquitectura

```
┌────────────────────────────────────────────────────────┐
│                 TERMUX (Android ARM64)                 │
│                                                        │
│  pm2                                                   │
│  ├── src/gateway/baileys.ts       (:3000)              │
│  │     └── messages.upsert ──► DurableTask.call()      │
│  │                                                     │
│  ├── src/workers/message.worker.ts                     │
│  │     └── BullMQ Worker ◄── queue                     │
│  │           └── FlowProducer (multi-step)             │
│  │                 └── Mastra Agent.generate()         │
│  │                       ├── Memory (LibSQL)           │
│  │                       ├── Tools                     │
│  │                       └── Groq / Ollama             │
│  │                                                     │
│  ├── src/dashboard/board.ts       (:3001/ui)           │
│  └── src/mastra/index.ts          (:4111 dev)          │
│                                                        │
│  redis-server                     (:6379)              │
└────────────────────────────────────────────────────────┘
```

## Instalación en Termux

```bash
# 1. Dependencias del sistema
pkg update && pkg upgrade -y
pkg install nodejs-lts redis git -y
npm install -g pm2 bun

# 2. Clonar e instalar
git clone https://github.com/Luillycarp/whatsapp-agent-termux
cd whatsapp-agent-termux
bun install

# 3. Configurar variables de entorno
cp .env.example .env
# Editar .env con tu GROQ_API_KEY

# 4. Iniciar Redis en background
redis-server --daemonize yes

# 5. Iniciar todos los procesos
pm2 start ecosystem.config.js
pm2 logs
```

## Estructura del proyecto

```
src/
├── gateway/
│   └── baileys.ts          # Conexión WhatsApp + reconexión automática
├── workers/
│   ├── message.worker.ts   # Worker principal BullMQ
│   └── llm.worker.ts       # Worker LLM (Flow child job)
├── tasks/
│   └── durable.ts          # DurableTask wrapper sobre BullMQ
├── mastra/
│   ├── index.ts            # Instancia Mastra principal
│   ├── agent.ts            # Definición del agente
│   ├── memory.ts           # Configuración memoria LibSQL
│   └── tools/
│       ├── datetime.tool.ts
│       └── web-search.tool.ts
├── dashboard/
│   └── board.ts            # Bull Board UI en :3001/ui
└── config/
    └── redis.ts            # Conexión Redis compartida
```

## Variables de entorno

Copiá `.env.example` a `.env` y completá:

| Variable | Descripción |
|---|---|
| `GROQ_API_KEY` | API key gratuita en [console.groq.com](https://console.groq.com) |
| `LLM_PROVIDER` | `groq` (default) o `ollama` |
| `OLLAMA_MODEL` | Ej: `qwen2.5:1.5b` para phones con poca RAM |
| `REDIS_URL` | `redis://localhost:6379` |

## Monitoreo

```bash
pm2 monit                    # Monitor procesos en tiempo real
pm2 logs                     # Todos los logs
pm2 logs baileys             # Solo gateway WhatsApp
```

- **Bull Board** (jobs): http://localhost:3001/ui
- **Mastra Playground** (agente): `bun run dev:mastra` → http://localhost:4111

## Mantener activo en Android

```bash
termux-wake-lock   # Evita que Android mate los procesos en background
```

## Créditos

- [WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys)
- [taskforcesh/bullmq](https://github.com/taskforcesh/bullmq)
- [mastra-ai/mastra](https://github.com/mastra-ai/mastra)
- DurableTask pattern: [svendewaerhert.com](https://www.svendewaerhert.com/blog/durable-task-primitive-with-bullmq/)
