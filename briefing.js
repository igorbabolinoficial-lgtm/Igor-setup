const cron = require('node-cron');
const { db, uid, nowIso, registrarLog } = require('./db');
const { migrarTudo } = require('./migrator');
const { gerarTexto, temAlgumLLM } = require('./agentes/ia');
const { heartbeat } = require('./agentes/base');
let registrarSinapse;
let contextoDNA = () => '';
try { ({ registrarSinapse, contextoDNA } = require('./routes/cerebro')); } catch (_) {}

async function hipotesesIgor(metricas) {
    if (!temAlgumLLM()) return null;
    const dna = contextoDNA(1500);
    const prompt = `Você é o Igor, IA da imobiliária da Praia do Rosa. Briefing diário pro Igor humano em pt-BR.

${dna ? `# DNA DA CASA\n${dna}\n` : ''}
# MÉTRICAS 24H
- Novos leads: ${metricas.novosLeads}
- Conversões: ${metricas.conversoes}
- Tarefas executadas (ok/err): ${metricas.tarefasOk}/${metricas.tarefasErr}
- Aprovações pendentes: ${metricas.aprovPend}
- Top leads quentes: ${metricas.topLeadsTxt}
- Eventos hoje: ${metricas.eventosTxt}

Escreva em markdown direto, máximo 12 linhas:
1) **3 hipóteses** sobre o que está acontecendo (curtas, baseadas nos números — não no genérico)
2) **3 ações prioritárias** pra hoje (foco em conversão e cuidado com leads quentes)

Sem introdução. Sem "espero ter ajudado". Direto ao ponto.`;
    const r = await gerarTexto(prompt);
    return r ? r.texto : null;
}

async function gerarBriefing() {
    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const novosLeads = db.prepare(`SELECT COUNT(*) AS n FROM leads WHERE criado_em >= ?`).get(desde).n;
    const conversoes = db.prepare(`SELECT COUNT(*) AS n FROM leads WHERE status='convertido' AND atualizado_em >= ?`).get(desde).n;
    const tarefasOk  = db.prepare(`SELECT COUNT(*) AS n FROM fila_tarefas WHERE status='concluida' AND concluido_em >= ?`).get(desde).n;
    const tarefasErr = db.prepare(`SELECT COUNT(*) AS n FROM fila_tarefas WHERE status='falhou' AND concluido_em >= ?`).get(desde).n;
    const aprovPend  = db.prepare(`SELECT COUNT(*) AS n FROM aprovacoes WHERE status='pendente'`).get().n;

    const inicioHoje = new Date(); inicioHoje.setHours(0,0,0,0);
    const fimHoje    = new Date(inicioHoje); fimHoje.setDate(fimHoje.getDate() + 1);
    const eventosHoje = db.prepare(`
        SELECT titulo, inicio FROM agenda WHERE inicio >= ? AND inicio < ? ORDER BY inicio ASC
    `).all(inicioHoje.toISOString(), fimHoje.toISOString());

    const topLeads = db.prepare(`
        SELECT nome, score_ia FROM leads
        WHERE status IN ('novo_lead', 'qualificado', 'em_atendimento')
        ORDER BY score_ia DESC LIMIT 3
    `).all();

    const topLeadsTxt = topLeads.map(l => `${l.nome}(${l.score_ia})`).join(', ') || 'nenhum';
    const eventosTxt = eventosHoje.map(e => e.titulo).join(', ') || 'nenhum';

    const hipoteses = await hipotesesIgor({ novosLeads, conversoes, tarefasOk, tarefasErr, aprovPend, topLeadsTxt, eventosTxt });

    const linhas = [
        `📊 Briefing matinal — ${new Date().toLocaleDateString('pt-BR')}`,
        '',
        `🆕 Leads nas últimas 24h: ${novosLeads}`,
        `🏆 Conversões nas últimas 24h: ${conversoes}`,
        `🤖 Tarefas executadas: ${tarefasOk} ok / ${tarefasErr} falhas`,
        `⏳ Aguardando sua aprovação: ${aprovPend}`,
        '',
        `📅 Hoje: ${eventosHoje.length} evento(s)`,
        ...eventosHoje.map(e => `   • ${new Date(e.inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} — ${e.titulo}`),
        '',
        `🔥 Top leads agora:`,
        ...topLeads.map(l => `   • ${l.nome} (${l.score_ia})`),
        ''
    ];
    if (hipoteses) {
        linhas.push('🧠 Hipóteses & plano (Igor IA):', '', hipoteses);
    } else {
        linhas.push('🧠 Plano: configure GEMINI_API_KEY pra Igor escrever hipóteses do dia.');
    }
    const texto = linhas.join('\n');

    const id = uid('brf');
    db.prepare(`
        INSERT INTO agenda (id, titulo, descricao, inicio, tipo)
        VALUES (?, ?, ?, ?, 'tarefa')
    `).run(id, 'Briefing matinal do Igor', texto, nowIso());

    heartbeat('maestro');
    registrarLog({
        agente: 'maestro', nivel: 'sucesso',
        mensagem: 'Briefing matinal gerado pelo Igor',
        contexto: { briefing_id: id, resumo: texto }
    });

    // Push proativo do briefing pro Telegram
    try {
        const { notificar } = require('./bot');
        notificar(texto.slice(0, 3500)).catch(() => {});
    } catch {}

    // Sinapse no Cérebro: briefing diário vira nota conectada ao hub
    if (registrarSinapse) {
        try {
            registrarSinapse({
                titulo: `Briefing — ${new Date().toLocaleDateString('pt-BR')}`,
                tipo: 'briefing',
                conteudo: texto,
                conectaCom: ['Igor_Babolin'],
                pasta: 'Briefings'
            });
        } catch (_) {}
    }

    return { id, texto, gerado_em: nowIso() };
}

function iniciar() {
    cron.schedule('0 7 * * *', gerarBriefing);
    cron.schedule('0 3 * * *', async () => {
        registrarLog({ agente: 'sistema', nivel: 'info', mensagem: 'Iniciando re-migração noturna do catálogo' });
        try { await migrarTudo({ skipExistentes: true }); }
        catch (e) { registrarLog({ agente: 'sistema', nivel: 'erro', mensagem: `Re-migração falhou: ${e.message}` }); }
    });
    registrarLog({ agente: 'maestro', nivel: 'info', mensagem: 'Cron ativo: briefing 07:00 + re-migração 03:00' });
}

// Alias pra ser usado pelo bot (/briefing). Devolve { id, texto, resumo, gerado_em }.
async function gerarAgora() {
    const r = await gerarBriefing();
    return { ...r, resumo: r.texto.slice(0, 500) };
}

module.exports = { iniciar, gerarBriefing, gerarAgora };
