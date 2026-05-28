const cron = require('node-cron');
const { db, registrarLog } = require('../db');
const { heartbeat, executarTarefa } = require('./base');

let GoogleGenerativeAI;
try { ({ GoogleGenerativeAI } = require('@google/generative-ai')); } catch (_) {}
let registrarSinapse;
try { ({ registrarSinapse } = require('../routes/cerebro')); } catch (_) {}

const especialistas = {
    sdr:         require('./sdr'),
    financeiro:  require('./financeiro'),
    designer:    require('./designer'),
    social:      require('./social'),
    pesquisa:    require('./pesquisa'),
    atendimento: require('./atendimento')
};

function getGeminiKey() {
    const cfg = db.prepare("SELECT valor FROM config WHERE chave = 'gemini_api_key'").get();
    return (cfg && cfg.valor) || process.env.GEMINI_API_KEY || '';
}

let rodando = false;
let pensandoComIA = false;

function jaTemPendente(agente_destino, tipo, leadId = null) {
    const where = ["status IN ('pendente','executando')", 'agente_destino = ?', 'tipo = ?'];
    const params = [agente_destino, tipo];
    if (leadId) {
        where.push("payload LIKE ?");
        params.push(`%${leadId}%`);
    }
    const r = db.prepare(`SELECT COUNT(*) AS n FROM fila_tarefas WHERE ${where.join(' AND ')}`).get(...params);
    return r.n > 0;
}

function enfileirar({ agente_destino, tipo, payload, prioridade = 5 }) {
    const r = db.prepare(`
        INSERT INTO fila_tarefas (agente_destino, tipo, payload, prioridade)
        VALUES (?, ?, ?, ?)
    `).run(agente_destino, tipo, payload ? JSON.stringify(payload) : null, prioridade);
    return r.lastInsertRowid;
}

// Maestro auto-aprova tudo — não exige intervenção humana pra executar tarefas.
// Tabela 'aprovacoes' é usada como log de auditoria (o que foi decidido e quando).
// O humano pode cancelar uma tarefa ainda pendente na fila pelo painel do dashboard.

// Dedup: verifica se já foi criado uma aprovação para esse lead+tipo nas últimas 24h
function jaAprovouRecente(agente_destino, tipo, leadId = null) {
    const limite = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const where  = ['agente_destino = ?', 'tipo = ?', "criado_em > ?"];
    const params = [agente_destino, tipo, limite];
    if (leadId) { where.push('payload LIKE ?'); params.push(`%${leadId}%`); }
    return db.prepare(`SELECT COUNT(*) AS n FROM aprovacoes WHERE ${where.join(' AND ')}`).get(...params).n > 0;
}

function dispararOuAprovar({ agente_destino, tipo, payload, prioridade, descricaoHumana }) {
    const leadId = payload && payload.lead_id;

    // Dedup duplo: tarefa ainda na fila OU aprovação já criada nas últimas 24h
    if (jaTemPendente(agente_destino, tipo, leadId)) return null;
    if (jaAprovouRecente(agente_destino, tipo, leadId)) return null;

    const tarefaId = enfileirar({ agente_destino, tipo, payload, prioridade });

    // Registra no histórico para auditoria e possível cancelamento
    const { nowIso } = require('../db');
    db.prepare(`
        INSERT INTO aprovacoes (agente_destino, tipo, payload, descricao, status, decidido_em, tarefa_id)
        VALUES (?, ?, ?, ?, 'aprovada', ?, ?)
    `).run(agente_destino, tipo, payload ? JSON.stringify(payload) : null, descricaoHumana, nowIso(), tarefaId);

    registrarLog({
        agente: 'maestro', nivel: 'info',
        mensagem: `Auto-aprovado: ${descricaoHumana}`,
        contexto: { tarefa_id: tarefaId }
    });
    return { tarefa_id: tarefaId };
}

// O Maestro Igor "pensa": escaneia estado e cria tarefas autonomamente
function pensar() {
    const decisoes = [];

    // 1) Leads sem score ainda → SDR qualifica (sem aprovação, é interno)
    const leadsSemScore = db.prepare(`
        SELECT id, nome FROM leads WHERE score_ia = 0 AND status != 'perdido' LIMIT 5
    `).all();
    for (const lead of leadsSemScore) {
        if (jaTemPendente('sdr', 'qualificar_lead', lead.id)) continue;
        enfileirar({ agente_destino: 'sdr', tipo: 'qualificar_lead', payload: { lead_id: lead.id }, prioridade: 3 });
        decisoes.push(`SDR vai qualificar ${lead.nome}`);
    }

    // 2) Leads qualificados sem follow_up nas últimas 24h → SDR follow_up (precisa aprovação)
    // Exclui leads de treino — follow_up de fantasma não faz sentido e polui aprovações
    const qualificados = db.prepare(`
        SELECT id, nome FROM leads
        WHERE status = 'qualificado'
          AND origem != 'treino'
          AND (ultimo_contato IS NULL OR ultimo_contato < datetime('now', '-1 day'))
        LIMIT 3
    `).all();
    for (const lead of qualificados) {
        if (jaTemPendente('sdr', 'follow_up', lead.id)) continue;
        const r = dispararOuAprovar({
            agente_destino: 'sdr', tipo: 'follow_up',
            payload: { lead_id: lead.id }, prioridade: 4,
            descricaoHumana: `Enviar follow_up para ${lead.nome}`
        });
        if (r) decisoes.push(r.aprovacao_id ? `Pediu aprovação p/ follow_up em ${lead.nome}` : `SDR vai dar follow_up em ${lead.nome}`);
    }

    // 3) Geração automática de posts pausada — skills de conteúdo ainda não configuradas.
    // Reativar quando copywriter/social estiver operacional.
    // const hoje = new Date().toISOString().slice(0, 10);
    // const postsHoje = db.prepare(`SELECT COUNT(*) AS n FROM agenda WHERE tipo='post' AND DATE(inicio)=?`).get(hoje);
    // if (postsHoje.n === 0 && !jaTemPendente('social','gerar_post')) {
    //     enfileirar({ agente_destino:'social', tipo:'gerar_post', payload:{tema:'Imóveis Praia do Rosa'}, prioridade:6 });
    //     decisoes.push('Social vai gerar post do dia');
    // }

    // 4) A cada ciclo, 30% de chance de pesquisa de mercado
    if (Math.random() < 0.3 && !jaTemPendente('pesquisa', 'pesquisar_mercado')) {
        enfileirar({ agente_destino: 'pesquisa', tipo: 'pesquisar_mercado', payload: { regiao: 'Praia do Rosa' }, prioridade: 7 });
        decisoes.push('Pesquisa vai escanear o mercado');
    }

    if (decisoes.length) {
        registrarLog({
            agente: 'maestro', nivel: 'info',
            mensagem: `Igor decidiu: ${decisoes.length} ação(ões)`,
            contexto: { decisoes }
        });
    }
    return decisoes;
}

async function ciclo() {
    if (rodando) return;
    rodando = true;
    heartbeat('maestro');
    try {
        // 1. Igor pensa e dispara tarefas
        pensar();

        // 2. Despacha o que tem na fila
        const tarefas = db.prepare(`
            SELECT * FROM fila_tarefas
            WHERE status = 'pendente'
            ORDER BY prioridade ASC, criado_em ASC
            LIMIT 10
        `).all();

        if (tarefas.length) {
            registrarLog({
                agente: 'maestro', nivel: 'info',
                mensagem: `Igor despachando ${tarefas.length} tarefa(s)`,
                contexto: { ids: tarefas.map(t => t.id) }
            });
        }

        for (const tarefa of tarefas) {
            const especialista = especialistas[tarefa.agente_destino];
            if (!especialista) {
                db.prepare("UPDATE fila_tarefas SET status = 'falhou', erro = ? WHERE id = ?")
                    .run(`Agente desconhecido: ${tarefa.agente_destino}`, tarefa.id);
                continue;
            }
            await executarTarefa(especialista, tarefa);
        }
    } catch (err) {
        registrarLog({ agente: 'maestro', nivel: 'erro', mensagem: err.message });
    } finally {
        rodando = false;
    }
}

// Igor pensa com Gemini de verdade — recebe estado, retorna decisões em JSON
async function pensarComIA() {
    if (pensandoComIA) return null;
    pensandoComIA = true;
    try {
        const apiKey = getGeminiKey();
        if (!apiKey || !GoogleGenerativeAI) return null;

        const leadsAtivos = db.prepare(`
            SELECT id, nome, interesse, status, score_ia,
                   COALESCE(ultimo_contato, '-') AS ultimo_contato
            FROM leads WHERE status NOT IN ('perdido', 'convertido')
            ORDER BY score_ia DESC LIMIT 20
        `).all();
        const filaAtual = db.prepare(`
            SELECT agente_destino, tipo, COUNT(*) AS n
            FROM fila_tarefas WHERE status IN ('pendente','executando')
            GROUP BY agente_destino, tipo
        `).all();
        const aprovPendentes = db.prepare(`SELECT COUNT(*) AS n FROM aprovacoes WHERE status='pendente'`).get().n;
        const totalImoveis = db.prepare(`SELECT COUNT(*) AS n FROM imoveis`).get().n;

        const ai = new GoogleGenerativeAI(apiKey);
        const model = ai.getGenerativeModel({ model: 'gemini-2.0-flash' });

        const prompt = `Você é o Igor, IA principal de uma imobiliária na Praia do Rosa (SC). Coordena 6 agentes especialistas.

ESTADO DO SISTEMA:
- ${leadsAtivos.length} leads ativos
- ${aprovPendentes} aprovações humanas pendentes
- Tarefas já na fila: ${filaAtual.map(f => `${f.agente_destino}/${f.tipo} (${f.n})`).join(', ') || 'nenhuma'}
- Catálogo: ${totalImoveis} imóveis disponíveis

LEADS:
${leadsAtivos.map(l => `- [${l.id}] ${l.nome} | ${l.interesse} | status=${l.status} | score=${l.score_ia}`).join('\n')}

AGENTES E TIPOS DE TAREFA:
- sdr: qualificar_lead, follow_up, boas_vindas
- financeiro: classificar_tx, relatorio_dre
- designer: gerar_arte, editar_imagem
- social: gerar_post, agendar_post, responder_dm
- pesquisa: pesquisar_mercado, monitorar_concorrencia, sugerir_imovel
- atendimento: atender_cliente, documentacao_pos

REGRAS:
1. NÃO duplique tarefas já presentes na fila.
2. Tarefas com lead específico DEVEM incluir lead_id no payload.
3. Máximo 5 decisões por chamada. Priorize alto impacto.
4. follow_up/responder_dm/boas_vindas vão pra aprovação humana antes (escolha quando for valioso ainda assim).

RESPONDA APENAS COM JSON VÁLIDO no formato:
{"decisoes":[{"agente":"sdr","tipo":"qualificar_lead","payload":{"lead_id":"abc"},"motivo":"score zerado"}]}`;

        const r = await model.generateContent(prompt);
        const txt = r.response.text();
        const json = txt.match(/\{[\s\S]*\}/);
        if (!json) {
            registrarLog({ agente: 'maestro', nivel: 'alerta', mensagem: 'Gemini não retornou JSON', contexto: { resposta: txt.slice(0, 200) } });
            return null;
        }
        const decisao = JSON.parse(json[0]);
        if (!Array.isArray(decisao.decisoes)) return null;

        const aplicadas = [];
        for (const d of decisao.decisoes.slice(0, 5)) {
            if (!especialistas[d.agente]) continue;
            const leadId = d.payload && d.payload.lead_id;
            if (jaTemPendente(d.agente, d.tipo, leadId)) continue;
            const r = dispararOuAprovar({
                agente_destino: d.agente, tipo: d.tipo, payload: d.payload || {},
                prioridade: 3, descricaoHumana: d.motivo || `${d.agente}/${d.tipo}`
            });
            if (r) aplicadas.push({ ...d, ...r });
        }

        if (aplicadas.length) {
            registrarLog({
                agente: 'maestro', nivel: 'sucesso',
                mensagem: `Igor (IA Gemini) decidiu: ${aplicadas.length} ação(ões)`,
                contexto: { decisoes: aplicadas }
            });
            // Sinapse: Igor escreve a decisão no Cérebro, conectando aos agentes envolvidos
            if (registrarSinapse) {
                try {
                    const conteudo = aplicadas.map(d =>
                        `- **${d.agente}** / ${d.tipo}\n  - Motivo: ${d.motivo || '-'}\n  - Payload: \`${JSON.stringify(d.payload || {})}\``
                    ).join('\n\n');
                    const agentesEnvolvidos = [...new Set(aplicadas.map(d => `Agente_${d.agente.charAt(0).toUpperCase() + d.agente.slice(1)}`))];
                    registrarSinapse({
                        titulo: `Decisão IA — ${new Date().toLocaleString('pt-BR')}`,
                        tipo: 'decisao',
                        conteudo: `## Decisões autônomas via Gemini\n\n${conteudo}`,
                        conectaCom: ['Igor_Babolin', ...agentesEnvolvidos],
                        pasta: 'Decisoes'
                    });
                } catch (_) {}
            }
        }
        return aplicadas;
    } catch (err) {
        registrarLog({ agente: 'maestro', nivel: 'erro', mensagem: `Igor IA falhou: ${err.message}` });
        return null;
    } finally {
        pensandoComIA = false;
    }
}

function iniciar() {
    // Cron a cada 15s pro pensar() heurístico (rápido, gratuito)
    cron.schedule('*/15 * * * * *', ciclo);
    // Cron a cada 5min pro pensarComIA() (LLM, mais inteligente)
    cron.schedule('*/5 * * * *', () => {
        if (getGeminiKey()) pensarComIA();
    });
    setTimeout(ciclo, 1500);
    registrarLog({ agente: 'maestro', nivel: 'sucesso', mensagem: 'Igor (Maestro) acordou — autopilot ativo (heurístico 15s + IA 5min)' });
    heartbeat('maestro');
}

module.exports = { iniciar, ciclo, pensar, pensarComIA, enfileirar, especialistas };
