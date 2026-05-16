// Bot Telegram do Igor — interface mobile pro Igor humano + Levi.
// Inspirado no maestro-skills do LMP (mesma arquitetura: Telegraf + allowlist + rate limit + hooks pros endpoints reais).
//
// Plug: server.js chama iniciarBot() no boot. Se IGOR_BOT_TOKEN não estiver setado, retorna false e segue silencioso.
// Permite que o servidor rode sem o bot enquanto Levi não criar o @Igor_Babolin_bot no BotFather.

const { registrarLog } = require('../db');
const registrarComandos = require('./comandos');
const { HANDLERS_POR_INTENT } = require('./comandos');
const { classificar } = require('./dispatcher');
const { transcreverAudio } = require('../agentes/ia');
const { matchSkill, executarSkill, listarSkills, buscarSkill } = require('./skills');

const RATE_LIMIT_MSG = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

function parseAllowlist() {
    const raw = process.env.IGOR_BOT_ALLOWED_USER_IDS || '';
    return raw.split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(n => !Number.isNaN(n));
}

function aplicarMiddlewares(bot) {
    const allowlist = parseAllowlist();
    const hits = new Map(); // user_id → array de timestamps

    bot.use(async (ctx, next) => {
        const userId = ctx.from?.id;
        if (!userId) return; // updates sem usuário (channel posts) — ignora

        // Allowlist obrigatória — Igor é privado, nunca aberto.
        if (allowlist.length === 0) {
            registrarLog({
                agente: 'bot', nivel: 'alerta',
                mensagem: 'IGOR_BOT_ALLOWED_USER_IDS vazio — bot vai recusar todas as mensagens. Configure no .env.'
            });
            return;
        }
        if (!allowlist.includes(userId)) {
            registrarLog({
                agente: 'bot', nivel: 'alerta',
                mensagem: `Tentativa de uso fora da allowlist`,
                contexto: { user_id: userId, username: ctx.from?.username },
            });
            return ctx.reply('Acesso restrito. Fale com o Levi.');
        }

        const agora = Date.now();
        const arr = (hits.get(userId) || []).filter(t => agora - t < RATE_LIMIT_WINDOW_MS);
        if (arr.length >= RATE_LIMIT_MSG) {
            return ctx.reply(`Rate limit: ${RATE_LIMIT_MSG} msgs/min. Aguarde alguns segundos.`);
        }
        arr.push(agora);
        hits.set(userId, arr);

        return next();
    });
}

let botInstance = null;

async function iniciarBot() {
    const token = process.env.IGOR_BOT_TOKEN;
    if (!token) {
        console.log('[bot] IGOR_BOT_TOKEN não setado — bot desligado');
        return false;
    }

    let Telegraf;
    try {
        ({ Telegraf } = require('telegraf'));
    } catch {
        console.log('[bot] telegraf não instalado — rode `npm install telegraf` na raiz do projeto');
        return false;
    }

    try {
        const bot = new Telegraf(token, { handlerTimeout: 10 * 60 * 1000 });
        aplicarMiddlewares(bot);
        registrarComandos(bot);

        // Comandos slash de skills (manuais — força execução de skill específica)
        bot.command('skills', async (ctx) => {
            const list = listarSkills();
            const linhas = list.map(s => `• \`${s.slug}\` — ${s.nome}\n  _${s.descricao}_`);
            await ctx.replyWithMarkdown(`*Skills disponiveis (${list.length})*\n\n${linhas.join('\n\n')}\n\nUse \`/skill <slug> <input>\` pra executar.`);
        });
        bot.command('skill', async (ctx) => {
            const parts = ctx.message.text.split(/\s+/);
            const slug = parts[1];
            const input = parts.slice(2).join(' ');
            if (!slug) return ctx.reply('Uso: /skill <slug> <input>. Veja /skills.');
            const s = buscarSkill(slug);
            if (!s) return ctx.reply(`Skill nao encontrada: ${slug}`);
            await ctx.reply(`⚙️ Executando *${s.nome}*...`, { parse_mode: 'Markdown' });
            const r = await executarSkill(slug, input);
            const out = (r.output || '').slice(0, 3800);
            await ctx.reply(out || 'Sem output');
        });
        bot.command('skill_new', async (ctx) => {
            const desc = ctx.message.text.replace(/^\/skill_new\s*/, '').trim();
            if (!desc) return ctx.reply('Uso: /skill_new <descricao da skill>');
            await ctx.reply('⚙️ Criando skill via Creator...');
            const r = await executarSkill('creator', desc);
            await ctx.reply(r.output || 'Sem output', { parse_mode: 'Markdown' });
        });

        // Dispatcher de linguagem natural — texto livre.
        // Ordem: 1) match skill (palavra-chave), se não → 2) dispatcher LLM (intent)
        bot.on('text', async (ctx) => {
            const texto = ctx.message?.text || '';
            if (texto.startsWith('/')) return;

            try {
                // 1) Skills sob demanda — match por palavra-chave (rápido, não chama LLM)
                const m = matchSkill(texto);
                if (m) {
                    await ctx.reply(`⚙️ Skill *${m.skill.nome}* acordada por palavra-chave`, { parse_mode: 'Markdown' });
                    const r = await executarSkill(m.skill, m.input);
                    return ctx.reply((r.output || 'Sem output').slice(0, 3800));
                }

                // 2) Dispatcher LLM → intents (status, leads, etc)
                const intents = await classificar(texto);
                for (const { intent, args } of intents) {
                    const fn = HANDLERS_POR_INTENT[intent];
                    if (!fn) continue;
                    await fn(ctx, intent === 'conversa' ? texto : args);
                }
            } catch (err) {
                registrarLog({ agente: 'bot', nivel: 'erro', mensagem: `dispatcher: ${err.message}` });
                await ctx.reply('Não entendi. Tenta com /ajuda pra ver os comandos.');
            }
        });

        // Áudio (voice/audio) — transcreve via Whisper e roteia pelo dispatcher
        bot.on(['voice', 'audio'], async (ctx) => {
            const file = ctx.message?.voice || ctx.message?.audio;
            if (!file) return;
            try {
                const link = await ctx.telegram.getFileLink(file.file_id);
                const res = await fetch(link.href);
                const buf = Buffer.from(await res.arrayBuffer());
                const filename = file.mime_type?.includes('mp3') ? 'audio.mp3' : 'audio.ogg';
                const texto = await transcreverAudio(buf, filename);
                if (!texto) return ctx.reply('Não consegui transcrever. Tenta de novo ou manda por texto.');
                await ctx.reply(`_Ouvi: "${texto}"_`, { parse_mode: 'Markdown' });
                // Roteia o texto transcrito pelo mesmo pipeline do dispatcher
                const intents = await classificar(texto);
                for (const { intent, args } of intents) {
                    const fn = HANDLERS_POR_INTENT[intent];
                    if (!fn) continue;
                    await fn(ctx, intent === 'conversa' ? texto : args);
                }
            } catch (err) {
                registrarLog({ agente: 'bot', nivel: 'erro', mensagem: `voice: ${err.message}` });
                await ctx.reply(`Erro no áudio: ${err.message}`);
            }
        });

        bot.catch((err, ctx) => {
            registrarLog({
                agente: 'bot', nivel: 'erro',
                mensagem: `bot.catch: ${err.message}`,
                contexto: { update_type: ctx.updateType, stack: err.stack?.slice(0, 500) },
            });
            try { ctx.reply('Erro no bot. Levi já foi notificado nos logs.'); } catch {}
        });

        await bot.launch();
        botInstance = bot;
        console.log('[bot] @Igor_Babolin_bot rodando (allowlist:', parseAllowlist().length, 'usuários)');
        registrarLog({ agente: 'bot', nivel: 'sucesso', mensagem: 'Bot Telegram iniciado' });

        process.once('SIGINT',  () => bot.stop('SIGINT'));
        process.once('SIGTERM', () => bot.stop('SIGTERM'));
        return true;
    } catch (err) {
        console.error('[bot] erro ao iniciar:', err.message);
        registrarLog({ agente: 'bot', nivel: 'erro', mensagem: `Falha ao iniciar bot: ${err.message}` });
        return false;
    }
}

// Notificação proativa: server.js chama notificar() pra mandar push pros allowed users.
async function notificar(texto, opts = {}) {
    if (!botInstance) return false;
    const allowlist = parseAllowlist();
    if (allowlist.length === 0) return false;
    const dest = opts.userId ? [opts.userId] : allowlist;
    let okCount = 0;
    for (const uid of dest) {
        try {
            await botInstance.telegram.sendMessage(uid, texto, { parse_mode: 'Markdown', ...opts });
            okCount++;
        } catch (err) {
            registrarLog({ agente: 'bot', nivel: 'alerta', mensagem: `notificar ${uid}: ${err.message}` });
        }
    }
    return okCount > 0;
}

module.exports = { iniciarBot, notificar };
