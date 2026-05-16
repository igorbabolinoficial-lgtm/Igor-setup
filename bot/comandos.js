// Comandos slash + handlers reutilizáveis pelo dispatcher de linguagem natural.
// Cada handler é uma função nomeada (recebe `ctx`, `args`) que consulta o SQLite direto
// e responde no Telegram. O dispatcher importa HANDLERS_POR_INTENT pra rotear texto livre.

const { db } = require('../db');

function fmtTempo(seg) {
    if (seg === null || seg === undefined) return 'nunca';
    if (seg < 60) return `${seg}s`;
    if (seg < 3600) return `${Math.floor(seg / 60)}min`;
    if (seg < 86400) return `${Math.floor(seg / 3600)}h`;
    return `${Math.floor(seg / 86400)}d`;
}

function escMd(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

const MENU = `*Igor Babolin Neural — Bot operacional*

Slash:
\`/status\`            visão geral do sistema
\`/leads\` [filtro]    lista leads (nome/status/segmento)
\`/lead <id>\`         detalhe do lead
\`/pendentes\`         fila de aprovações
\`/aprovar <id>\`      aprova ação pendente
\`/rejeitar <id>\`     rejeita ação pendente
\`/imoveis\` [busca]   busca catálogo (tipo, bairro, palavra)
\`/imovel <id>\`       detalhe do imóvel
\`/briefing\`          dispara briefing manual
\`/log\` [agente]      últimos 10 logs
\`/agenda\`            próximos eventos
\`/timeline <lead_id>\` timeline do lead
\`/ajuda\`             este menu

Você também pode mandar texto livre ou áudio — eu classifico e roteio.`;

async function handleAjuda(ctx) {
    await ctx.replyWithMarkdown(MENU);
}

async function handleStatus(ctx) {
    try {
        const leadsNovos = db.prepare(`SELECT COUNT(*) AS n FROM leads WHERE status = 'novo_lead' AND COALESCE(arquivado, 0) = 0`).get().n;
        const leadsHoje = db.prepare(`SELECT COUNT(*) AS n FROM leads WHERE date(criado_em) = date('now') AND COALESCE(arquivado, 0) = 0`).get().n;
        const aprovPend = db.prepare(`SELECT COUNT(*) AS n FROM aprovacoes WHERE status = 'pendente'`).get().n;
        const imoveis = db.prepare(`SELECT COUNT(*) AS n FROM imoveis`).get().n;
        const tarefasExec = db.prepare(`SELECT COUNT(*) AS n FROM fila_tarefas WHERE status = 'executando'`).get().n;
        const tarefasPend = db.prepare(`SELECT COUNT(*) AS n FROM fila_tarefas WHERE status = 'pendente'`).get().n;
        const logs24h = db.prepare(`SELECT COUNT(*) AS n FROM logs WHERE criado_em >= datetime('now', '-24 hours')`).get().n;
        const erros24h = db.prepare(`SELECT COUNT(*) AS n FROM logs WHERE nivel IN ('erro','alerta') AND criado_em >= datetime('now', '-24 hours')`).get().n;

        await ctx.replyWithMarkdown(
`*Status Igor — agora*

Leads: *${leadsNovos}* novos · ${leadsHoje} hoje
Aprovações pendentes: *${aprovPend}*
Catálogo: ${imoveis} imóveis
Fila: ${tarefasExec} executando, ${tarefasPend} pendentes
Logs 24h: ${logs24h}${erros24h > 0 ? ` (\\*${erros24h} erros\\*)` : ''}`
        );
    } catch (err) {
        await ctx.reply(`Erro: ${err.message}`);
    }
}

async function handleLeads(ctx, filtroRaw = '') {
    const filtro = String(filtroRaw || '').toLowerCase().trim();
    try {
        const where = [`COALESCE(arquivado, 0) = 0`];
        const params = [];
        if (filtro) {
            where.push(`(LOWER(nome) LIKE ? OR LOWER(interesse) LIKE ? OR LOWER(status) LIKE ? OR LOWER(COALESCE(segmento,'')) LIKE ?)`);
            const like = `%${filtro}%`;
            params.push(like, like, like, like);
        } else {
            where.push(`origem != 'treino'`);
        }
        const rows = db.prepare(`
            SELECT id, nome, interesse, status, score_ia, segmento, criado_em
            FROM leads
            WHERE ${where.join(' AND ')}
            ORDER BY criado_em DESC
            LIMIT 15
        `).all(...params);
        if (!rows.length) return ctx.reply('Nenhum lead com esse filtro.');
        const linhas = rows.map(r =>
            `· *${escMd(r.nome)}* — ${escMd(r.interesse || '—')}\n  _${r.status}_${r.segmento ? ` · ${r.segmento}` : ''}${r.score_ia ? ` · score ${r.score_ia}` : ''}\n  \`${r.id}\``
        );
        await ctx.replyWithMarkdown(`*Leads (${rows.length})*\n\n${linhas.join('\n\n')}`);
    } catch (err) {
        await ctx.reply(`Erro: ${err.message}`);
    }
}

async function handleLead(ctx, id) {
    if (!id) return ctx.reply('Uso: /lead <id>');
    try {
        const lead = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(id);
        if (!lead) return ctx.reply('Lead não encontrado.');
        const tags = lead.tags_ia ? JSON.parse(lead.tags_ia).join(', ') : '—';
        const logs = db.prepare(`SELECT criado_em, agente, mensagem FROM logs WHERE contexto LIKE ? ORDER BY criado_em DESC LIMIT 5`).all(`%${id}%`);
        const logStr = logs.length ? logs.map(l => `  · ${l.criado_em.slice(5, 16)} \\[${l.agente}\\] ${escMd(l.mensagem.slice(0, 80))}`).join('\n') : '  (sem logs)';
        await ctx.replyWithMarkdown(
`*${escMd(lead.nome)}*

Status: \`${lead.status}\`
Interesse: ${escMd(lead.interesse || '—')}
Origem: ${escMd(lead.origem || '—')}
Score: ${lead.score_ia || 0} · Segmento: ${escMd(lead.segmento || '—')}
Tags: ${escMd(tags)}
Telefone: ${escMd(lead.telefone || '—')}

*Últimos logs:*
${logStr}`
        );
    } catch (err) {
        await ctx.reply(`Erro: ${err.message}`);
    }
}

async function handlePendentes(ctx) {
    try {
        const rows = db.prepare(`
            SELECT id, agente_destino, tipo, payload, criado_em
            FROM aprovacoes
            WHERE status = 'pendente'
            ORDER BY criado_em DESC
            LIMIT 20
        `).all();
        if (!rows.length) return ctx.reply('Sem aprovações pendentes.');
        const linhas = rows.map(r => {
            let preview = '';
            try {
                const p = JSON.parse(r.payload || '{}');
                preview = (p.mensagem || p.copy || p.headline || '').slice(0, 80);
            } catch {}
            return `· \`${r.id}\` _${r.tipo}_ \\[${r.agente_destino}\\]${preview ? `\n  ${escMd(preview)}` : ''}`;
        });
        await ctx.replyWithMarkdown(`*Aprovações pendentes (${rows.length})*\n\n${linhas.join('\n\n')}\n\nResponda com \`/aprovar <id>\` ou \`/rejeitar <id> <motivo>\``);
    } catch (err) {
        await ctx.reply(`Erro: ${err.message}`);
    }
}

async function handleAprovar(ctx, id) {
    if (!id) return ctx.reply('Uso: /aprovar <id>');
    try {
        const r = db.prepare(`UPDATE aprovacoes SET status = 'aprovada', decidido_em = datetime('now') WHERE id = ? AND status = 'pendente'`).run(id);
        if (r.changes === 0) return ctx.reply('Aprovação não encontrada ou já decidida.');
        await ctx.reply(`Aprovada: ${id}`);
    } catch (err) {
        await ctx.reply(`Erro: ${err.message}`);
    }
}

async function handleRejeitar(ctx, args) {
    const parts = String(args || '').trim().split(/\s+/);
    const id = parts[0];
    const motivo = parts.slice(1).join(' ') || 'sem motivo';
    if (!id) return ctx.reply('Uso: /rejeitar <id> [motivo]');
    try {
        // Schema aprovacoes não tem motivo_rejeicao por default — fallback pra descricao
        const temColMotivo = db.prepare(`PRAGMA table_info(aprovacoes)`).all().some(c => c.name === 'motivo_rejeicao');
        const sql = temColMotivo
            ? `UPDATE aprovacoes SET status = 'rejeitada', decidido_em = datetime('now'), motivo_rejeicao = ? WHERE id = ? AND status = 'pendente'`
            : `UPDATE aprovacoes SET status = 'rejeitada', decidido_em = datetime('now'), descricao = COALESCE(descricao, '') || ' [REJEITADO: ' || ? || ']' WHERE id = ? AND status = 'pendente'`;
        const r = db.prepare(sql).run(motivo, id);
        if (r.changes === 0) return ctx.reply('Aprovação não encontrada ou já decidida.');
        await ctx.reply(`Rejeitada: ${id}\nMotivo: ${motivo}`);
    } catch (err) {
        await ctx.reply(`Erro: ${err.message}`);
    }
}

async function handleImoveis(ctx, filtroRaw = '') {
    const filtro = String(filtroRaw || '').toLowerCase().trim();
    try {
        const where = [];
        const params = [];
        if (filtro) {
            where.push(`(LOWER(titulo) LIKE ? OR LOWER(descricao) LIKE ? OR LOWER(tipo) LIKE ? OR LOWER(COALESCE(bairro,'')) LIKE ?)`);
            const like = `%${filtro}%`;
            params.push(like, like, like, like);
        }
        const rows = db.prepare(`
            SELECT id, titulo, preco, tipo, bairro
            FROM imoveis
            ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
            ORDER BY (preco IS NULL) ASC, preco DESC
            LIMIT 15
        `).all(...params);
        if (!rows.length) return ctx.reply('Nenhum imóvel com esse filtro.');
        const linhas = rows.map(r =>
            `· *${escMd((r.titulo || '—').slice(0, 60))}*\n  ${escMd(r.tipo || '—')}${r.bairro ? ` · ${escMd(r.bairro)}` : ''}${r.preco ? ` · R$ ${r.preco.toLocaleString('pt-BR')}` : ''}\n  \`${r.id}\``
        );
        await ctx.replyWithMarkdown(`*Imóveis (${rows.length})*\n\n${linhas.join('\n\n')}`);
    } catch (err) {
        await ctx.reply(`Erro: ${err.message}`);
    }
}

async function handleImovel(ctx, id) {
    if (!id) return ctx.reply('Uso: /imovel <id|slug>');
    try {
        const row = db.prepare(`SELECT * FROM imoveis WHERE id = ? OR slug = ?`).get(id, id);
        if (!row) return ctx.reply('Imóvel não encontrado.');
        await ctx.replyWithMarkdown(
`*${escMd(row.titulo)}*

Tipo: ${escMd(row.tipo || '—')}
Bairro: ${escMd(row.bairro || '—')}
Preço: ${row.preco ? `R$ ${row.preco.toLocaleString('pt-BR')}` : '—'}
${row.url_origem ? `[Ver no site](${row.url_origem})` : ''}

${escMd((row.descricao || '').slice(0, 400))}`
        );
    } catch (err) {
        await ctx.reply(`Erro: ${err.message}`);
    }
}

async function handleBriefing(ctx) {
    await ctx.reply('Disparando briefing em background. Te aviso quando terminar.');
    try {
        const briefing = require('../briefing');
        const r = await briefing.gerarAgora();
        await ctx.replyWithMarkdown(`Briefing pronto.\n\n${escMd((r?.resumo || '').slice(0, 500))}`);
    } catch (err) {
        await ctx.reply(`Briefing falhou: ${err.message}`);
    }
}

async function handleAgenda(ctx) {
    try {
        const rows = db.prepare(`
            SELECT id, titulo, inicio, tipo, status
            FROM agenda
            WHERE inicio >= datetime('now')
            ORDER BY inicio ASC
            LIMIT 5
        `).all();
        if (!rows.length) return ctx.reply('Sem eventos futuros na agenda.');
        const linhas = rows.map(r => {
            const d = new Date(r.inicio);
            const data = d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            return `· *${data}* — ${escMd(r.titulo)}\n  _${r.tipo}_ · ${r.status}`;
        });
        await ctx.replyWithMarkdown(`*Próximos eventos*\n\n${linhas.join('\n\n')}`);
    } catch (err) {
        await ctx.reply(`Erro: ${err.message}`);
    }
}

async function handleTimeline(ctx, id) {
    if (!id) return ctx.reply('Uso: /timeline <lead_id>');
    try {
        const lead = db.prepare(`SELECT nome FROM leads WHERE id = ?`).get(id);
        if (!lead) return ctx.reply('Lead não encontrado.');
        const eventos = db.prepare(`
            SELECT criado_em, agente, nivel, mensagem
            FROM logs
            WHERE contexto LIKE ?
            ORDER BY criado_em DESC LIMIT 15
        `).all(`%${id}%`);
        if (!eventos.length) return ctx.reply(`Lead ${lead.nome}: timeline vazia.`);
        const linhas = eventos.map(e =>
            `${e.criado_em.slice(5, 16)} [${e.agente}/${e.nivel}] ${e.mensagem.slice(0, 90)}`
        );
        await ctx.replyWithMarkdown(`*Timeline — ${escMd(lead.nome)}*\n\n\`\`\`\n${linhas.join('\n')}\n\`\`\``);
    } catch (err) {
        await ctx.reply(`Erro: ${err.message}`);
    }
}

async function handleLog(ctx, agente = '') {
    try {
        const where = agente ? `WHERE agente = ?` : '';
        const params = agente ? [agente] : [];
        const rows = db.prepare(`
            SELECT criado_em, agente, nivel, mensagem
            FROM logs ${where}
            ORDER BY criado_em DESC LIMIT 10
        `).all(...params);
        if (!rows.length) return ctx.reply('Sem logs.');
        const linhas = rows.map(r => `${r.criado_em.slice(5, 16)} [${r.agente}/${r.nivel}] ${r.mensagem.slice(0, 100)}`);
        await ctx.replyWithMarkdown(`\`\`\`\n${linhas.join('\n')}\n\`\`\``);
    } catch (err) {
        await ctx.reply(`Erro: ${err.message}`);
    }
}

// Conversa livre = IA responde com contexto leve do sistema
async function handleConversa(ctx, texto) {
    try {
        const { gerarTexto, temAlgumLLM } = require('../agentes/ia');
        if (!temAlgumLLM()) return ctx.reply('Sem LLM configurado. Plugue GROQ_API_KEY no .env.');
        const stats = db.prepare(`SELECT COUNT(*) AS n FROM leads WHERE COALESCE(arquivado,0)=0`).get().n;
        const pendentes = db.prepare(`SELECT COUNT(*) AS n FROM aprovacoes WHERE status='pendente'`).get().n;
        const prompt = `Você é o bot de operações do Igor Babolin (imobiliária Praia do Rosa). Levi está conversando.
Sistema: ${stats} leads, ${pendentes} aprovações pendentes.

Levi: ${texto}

Responda direto e útil em pt-BR, máx 4 linhas. Se a pergunta exige dado específico (lead X, imóvel Y), diga qual comando usar (\`/lead\`, \`/imovel\`, etc) em vez de inventar.`;
        const r = await gerarTexto(prompt);
        await ctx.reply(r?.texto || 'Sem resposta da IA.');
    } catch (err) {
        await ctx.reply(`Erro: ${err.message}`);
    }
}

// Mapa intent → handler. Dispatcher (bot/dispatcher.js) usa isso pra rotear texto livre.
const HANDLERS_POR_INTENT = {
    ajuda: handleAjuda,
    status: handleStatus,
    leads: handleLeads,
    lead: handleLead,
    pendentes: handlePendentes,
    aprovar: handleAprovar,
    rejeitar: handleRejeitar,
    imoveis: handleImoveis,
    imovel: handleImovel,
    briefing: handleBriefing,
    log: handleLog,
    agenda: handleAgenda,
    timeline: handleTimeline,
    conversa: handleConversa,
};

function registrarComandos(bot) {
    bot.start((ctx) => handleAjuda(ctx));
    bot.command('ajuda', (ctx) => handleAjuda(ctx));
    bot.command('status', (ctx) => handleStatus(ctx));
    bot.command('leads', (ctx) => handleLeads(ctx, argsDoCtx(ctx)));
    bot.command('lead', (ctx) => handleLead(ctx, argsDoCtx(ctx)));
    bot.command('pendentes', (ctx) => handlePendentes(ctx));
    bot.command('aprovar', (ctx) => handleAprovar(ctx, argsDoCtx(ctx)));
    bot.command('rejeitar', (ctx) => handleRejeitar(ctx, argsDoCtx(ctx)));
    bot.command('imoveis', (ctx) => handleImoveis(ctx, argsDoCtx(ctx)));
    bot.command('imovel', (ctx) => handleImovel(ctx, argsDoCtx(ctx)));
    bot.command('briefing', (ctx) => handleBriefing(ctx));
    bot.command('log', (ctx) => handleLog(ctx, argsDoCtx(ctx)));
    bot.command('agenda', (ctx) => handleAgenda(ctx));
    bot.command('timeline', (ctx) => handleTimeline(ctx, argsDoCtx(ctx)));
}

function argsDoCtx(ctx) {
    const parts = (ctx.message?.text || '').split(/\s+/);
    return parts.slice(1).join(' ');
}

module.exports = registrarComandos;
module.exports.HANDLERS_POR_INTENT = HANDLERS_POR_INTENT;
