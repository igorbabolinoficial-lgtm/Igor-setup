const express = require('express');
const { db, uid, nowIso, registrarLog } = require('../db');
const { gerarTexto, temAlgumLLM } = require('../agentes/ia');

const router = express.Router();

let GoogleGenerativeAI;
try {
    ({ GoogleGenerativeAI } = require('@google/generative-ai'));
} catch (_) {
    GoogleGenerativeAI = null;
}

function getApiKey() {
    const cfg = db.prepare('SELECT valor FROM config WHERE chave = ?').get('gemini_api_key');
    return (cfg && cfg.valor) || process.env.GEMINI_API_KEY || '';
}

// Rate limit simples in-memory para endpoints públicos: 20 req/min por IP
const limites = new Map();
function rateLimit(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const agora = Date.now();
    const janela = 60_000;
    const limite = 20;
    const hist = (limites.get(ip) || []).filter(t => agora - t < janela);
    if (hist.length >= limite) {
        return res.status(429).json({ erro: 'Muitas requisições. Tente em 1 minuto.' });
    }
    hist.push(agora);
    limites.set(ip, hist);
    next();
}

function montarContextoLeads() {
    const leads = db.prepare(`
        SELECT id, nome, interesse, status, score_ia, ultimo_contato
        FROM leads
        ORDER BY score_ia DESC
        LIMIT 50
    `).all();
    if (!leads.length) return 'Base de leads vazia.';
    return leads.map(l =>
        `- ${l.nome} | ${l.interesse || '-'} | status=${l.status} | score=${l.score_ia} | último=${l.ultimo_contato || '-'}`
    ).join('\n');
}

function montarContextoCerebro() {
    try {
        const { carregarNotas, notasConectadas } = require('./cerebro');
        const todas = carregarNotas();
        if (!todas.length) return '';
        // Foca no hub Igor_Babolin e tudo conectado a ele (até depth 2)
        const conectadas = notasConectadas('Igor_Babolin', todas, 2);
        if (!conectadas.length) {
            // fallback: pega 5 mais recentes
            return todas.slice(0, 5).map(n => `### ${n.titulo} [${n.tipo || 'sem_tipo'}]\n${n.corpo.slice(0, 600)}`).join('\n\n');
        }
        const linhas = conectadas.slice(0, 8).map(n => {
            const sinapsesTxt = n.sinapses.map(s => `${s.alvo} (${s.sinapse})`).join(', ') || '-';
            return `### ${n.titulo} [tipo:${n.tipo || 'sem_tipo'}]\n_Sinapses: ${sinapsesTxt}_\n${n.corpo.slice(0, 700)}`;
        });
        return `# CÉREBRO NEURAL — Hub Igor_Babolin\n${linhas.join('\n\n')}`;
    } catch (_) { return ''; }
}

router.post('/consulta', async (req, res, next) => {
    try {
        const { pergunta } = req.body || {};
        if (!pergunta) return res.status(400).json({ erro: 'pergunta é obrigatória' });

        const { gerarTexto, temAlgumLLM } = require('../agentes/ia');

        if (!temAlgumLLM()) {
            const resposta = `Nenhuma chave de IA configurada. Pergunta: "${pergunta}"\n\nTop leads:\n${montarContextoLeads()}`;
            registrarLog({ agente: 'sdr', nivel: 'alerta', mensagem: 'Consulta IA sem chave configurada', contexto: { pergunta } });
            return res.json({ resposta, modo: 'fallback' });
        }

        const persona = process.env.PERSONA_SDR || 'Corretor de Elite — Igor Babolin';
        const contextoLeads = montarContextoLeads();
        const contextoCerebro = montarContextoCerebro();
        const prompt = `Você é o agente SDR do ${persona}. Responda em pt-BR, direto e acionável.${contextoCerebro ? `\n\n# CÉREBRO (Obsidian)\n${contextoCerebro}` : ''}\n\n# BASE DE LEADS\n${contextoLeads}\n\n# PERGUNTA\n${pergunta}`;

        const r = await gerarTexto(prompt);
        if (!r) {
            registrarLog({ agente: 'sdr', nivel: 'alerta', mensagem: 'Todos os LLMs falharam na consulta', contexto: { pergunta } });
            return res.json({ resposta: 'Não consegui responder agora. Tente novamente em instantes.', modo: 'fallback' });
        }

        registrarLog({ agente: 'sdr', nivel: 'sucesso', mensagem: 'Consulta IA respondida', contexto: { pergunta, modelo: r.modelo } });
        res.json({ resposta: r.texto, modo: r.modelo });
    } catch (err) {
        next(err);
    }
});

router.post('/qualificar/:lead_id', async (req, res, next) => {
    try {
        const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.lead_id);
        if (!lead) return res.status(404).json({ erro: 'Lead não encontrado' });

        const apiKey = getApiKey();
        if (!apiKey || !GoogleGenerativeAI) {
            const score = Math.floor(Math.random() * 40) + 50;
            db.prepare('UPDATE leads SET score_ia = ? WHERE id = ?').run(score, lead.id);
            registrarLog({ agente: 'sdr', nivel: 'alerta', template: 'qualificacao', mensagem: `Qualificação heurística (sem IA) — ${lead.nome}: ${score}`, contexto: { lead_id: lead.id } });
            return res.json({ score_ia: score, modo: 'fallback' });
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        const prompt = `Avalie o potencial de conversão (0 a 100) deste lead imobiliário. Responda APENAS com o número.\n\nNome: ${lead.nome}\nInteresse: ${lead.interesse}\nNotas: ${lead.notas || '-'}`;
        const r = await model.generateContent(prompt);
        const txt = r.response.text().trim();
        const score = Math.max(0, Math.min(100, parseInt(txt.match(/\d+/)?.[0] || '0', 10)));

        db.prepare('UPDATE leads SET score_ia = ? WHERE id = ?').run(score, lead.id);
        registrarLog({ agente: 'sdr', nivel: 'sucesso', template: 'qualificacao', mensagem: `${lead.nome} qualificado: ${score}`, contexto: { lead_id: lead.id } });
        res.json({ score_ia: score, modo: 'gemini' });
    } catch (err) {
        next(err);
    }
});

// === Endpoint público — chatbot do site (sem segredo) ===
function montarContextoPublico() {
    const stats = db.prepare("SELECT COUNT(*) AS n FROM imoveis").get().n;
    const tipos = db.prepare("SELECT tipo, COUNT(*) AS n FROM imoveis GROUP BY tipo ORDER BY n DESC LIMIT 5").all();
    const faixas = db.prepare("SELECT MIN(preco) AS minimo, MAX(preco) AS maximo FROM imoveis WHERE preco > 0").get();
    return `
CATÁLOGO DA IMOBILIÁRIA:
- ${stats} imóveis disponíveis na Praia do Rosa, Ibiraquera, Garopaba e região.
- Tipos: ${tipos.map(t => `${t.tipo} (${t.n})`).join(', ') || 'variados'}.
- Faixa: R$ ${Number(faixas.minimo).toLocaleString('pt-BR')} a R$ ${Number(faixas.maximo).toLocaleString('pt-BR')}.

VOCÊ É: o assistente virtual do Igor Babolin Imóveis. Atende visitantes do site público, em pt-BR.
TOM: acolhedor, direto, sem clichê de corretor. Máximo 4 linhas por resposta.
SEMPRE: pergunte o nome se ainda não souber, depois telefone (pra Igor entrar em contato). Se a pessoa quer um imóvel específico, sugira marcar uma conversa pelo WhatsApp.
NÃO: não invente imóveis ou preços; convide pra ver o catálogo na própria página.`;
}

router.post('/publica', rateLimit, async (req, res, next) => {
    try {
        const { mensagem, historico = [], nome, telefone, sessao_id } = req.body || {};
        if (!mensagem || mensagem.length > 2000) {
            return res.status(400).json({ erro: 'Mensagem inválida (1-2000 chars)' });
        }

        // Se a pessoa compartilhou contato e é a primeira vez nesta sessão, criar lead
        let lead_criado = null;
        if (nome && telefone) {
            const tel = String(telefone).replace(/\D/g, '');
            const ja = db.prepare('SELECT id FROM leads WHERE telefone = ?').get(tel);
            if (!ja) {
                const id = uid('lead_chat');
                db.prepare(`
                    INSERT INTO leads (id, nome, telefone, origem, status, notas)
                    VALUES (?, ?, ?, 'site_chat', 'novo_lead', ?)
                `).run(id, nome.slice(0, 80), tel, `Capturado pelo chatbot público. Sessão: ${sessao_id || '-'}. Mensagem inicial: ${mensagem.slice(0, 300)}`);
                lead_criado = id;
                registrarLog({
                    agente: 'sdr', nivel: 'sucesso', template: 'boas_vindas',
                    mensagem: `Lead capturado pelo chatbot público: ${nome}`,
                    contexto: { lead_id: id, telefone: tel, sessao_id }
                });
                try {
                    const { notificar } = require('../bot');
                    notificar(
                        `*Lead novo via site*\n\n*Nome:* ${nome}\n*Tel:* ${tel}\n*Mensagem:* ${mensagem.slice(0, 200)}\n\n\`/lead ${id}\` pra detalhe`,
                    ).catch(() => {});
                } catch {}
            }
        }

        // Resposta IA
        if (!temAlgumLLM()) {
            return res.json({
                resposta: 'Olá! No momento o assistente virtual está em manutenção. Por favor fale com a gente pelo WhatsApp ou navegue pelo catálogo logo abaixo.',
                modo: 'fallback',
                lead_criado
            });
        }

        const ctx = montarContextoPublico();
        const histTxt = (historico || []).slice(-6).map(h => `${h.de === 'usuario' ? 'Cliente' : 'Igor'}: ${h.texto}`).join('\n');
        const idente = nome ? `Cliente: ${nome}${telefone ? ' (tel já capturado)' : ' (ainda sem telefone)'}` : 'Cliente: anônimo (ainda sem nome)';

        const prompt = `${ctx}\n\n${idente}\n\nHISTÓRICO RECENTE:\n${histTxt || '(início da conversa)'}\n\nNOVA MENSAGEM:\nCliente: ${mensagem}\n\nResponda como Igor (assistente):`;

        const r = await gerarTexto(prompt);
        const resposta = (r && r.texto) || 'Recebi sua mensagem. Pode me dar seu nome e telefone pra eu te ajudar melhor?';

        registrarLog({
            agente: 'sdr', nivel: 'info',
            mensagem: `Chatbot público: "${mensagem.slice(0, 80)}"`,
            contexto: { sessao_id, nome, lead_criado, modelo: r && r.modelo }
        });

        res.json({ resposta, modo: r ? r.modelo : 'fallback', lead_criado });
    } catch (err) { next(err); }
});

module.exports = router;
