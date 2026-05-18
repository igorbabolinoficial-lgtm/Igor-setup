const express = require('express');
const fs = require('fs');
const path = require('path');
const { db } = require('../db');

const router = express.Router();

router.get('/saude', (_req, res) => {
    const agora = new Date();

    // Banco
    const totalLeads     = db.prepare('SELECT COUNT(*) AS n FROM leads').get().n;
    const totalAgenda    = db.prepare('SELECT COUNT(*) AS n FROM agenda').get().n;
    const totalLogs      = db.prepare('SELECT COUNT(*) AS n FROM logs').get().n;
    const totalImoveis   = db.prepare('SELECT COUNT(*) AS n FROM imoveis').get().n;
    const totalTarefas   = db.prepare('SELECT COUNT(*) AS n FROM fila_tarefas').get().n;
    const totalAgentes   = db.prepare('SELECT COUNT(*) AS n FROM agentes').get().n;
    const aprovPendentes = db.prepare("SELECT COUNT(*) AS n FROM aprovacoes WHERE status='pendente'").get().n;

    // Maestro vivo?
    const maestro = db.prepare("SELECT * FROM agentes WHERE chave='maestro'").get();
    const heartbeatMs = maestro && maestro.ultimo_heartbeat
        ? agora - new Date(maestro.ultimo_heartbeat)
        : null;
    const igorVivo = heartbeatMs !== null && heartbeatMs < 60_000;

    // Cérebro Obsidian acessível?
    const cerebroPath = process.env.OBSIDIAN_PATH;
    const cerebroOk = !!cerebroPath && fs.existsSync(cerebroPath);

    // IA configurada?
    const geminiKey = (db.prepare("SELECT valor FROM config WHERE chave='gemini_api_key'").get() || {}).valor
                    || process.env.GEMINI_API_KEY;
    const anthropicKey = (db.prepare("SELECT valor FROM config WHERE chave='anthropic_api_key'").get() || {}).valor
                       || process.env.ANTHROPIC_API_KEY;

    // Catálogo: assets em disco
    const assetsDir = path.join(__dirname, '..', 'public', 'assets', 'imoveis');
    const pastasImoveis = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).length : 0;

    // Última migração + último briefing nos logs
    const ultimaMigracao = db.prepare(`
        SELECT mensagem, criado_em FROM logs
        WHERE mensagem LIKE '%Migração%' OR mensagem LIKE '%re-migração%'
        ORDER BY criado_em DESC LIMIT 1
    `).get();
    const ultimoBriefing = db.prepare(`
        SELECT criado_em FROM logs
        WHERE mensagem LIKE '%Briefing matinal%' AND nivel='sucesso'
        ORDER BY criado_em DESC LIMIT 1
    `).get();

    // Última decisão do Igor (heurística vs IA)
    const ultimaDecisaoIgor = db.prepare(`
        SELECT mensagem, criado_em FROM logs
        WHERE agente='maestro' AND mensagem LIKE '%decidiu%'
        ORDER BY criado_em DESC LIMIT 1
    `).get();

    res.json({
        sistema: {
            projeto: 'igor-neural-system',
            versao: '0.2.0',
            timestamp: agora.toISOString()
        },
        igor: {
            vivo: igorVivo,
            ultimo_heartbeat: maestro && maestro.ultimo_heartbeat,
            tempo_desde_heartbeat_ms: heartbeatMs,
            tarefas_executadas: maestro && maestro.tarefas_executadas,
            tarefas_falhadas: maestro && maestro.tarefas_falhadas,
            modo_ia: geminiKey ? 'gemini-2.0-flash + heuristico' : 'heuristico_apenas',
            ultima_decisao: ultimaDecisaoIgor || null
        },
        rede: {
            agentes_total: totalAgentes,
            tarefas_total: totalTarefas,
            aprovacoes_pendentes: aprovPendentes
        },
        crm: {
            leads: totalLeads,
            agenda_eventos: totalAgenda,
            logs: totalLogs
        },
        catalogo: {
            imoveis: totalImoveis,
            pastas_fotos: pastasImoveis,
            ultima_migracao: ultimaMigracao || null
        },
        cerebro_obsidian: {
            configurado: !!cerebroPath,
            acessivel: cerebroOk,
            caminho: cerebroPath || null
        },
        ia: {
            gemini_configurado:    !!geminiKey,
            anthropic_configurado: !!anthropicKey
        },
        rotinas: {
            briefing_diario:    { cron: '0 8 * * *', ultimo: ultimoBriefing || null },
            re_migracao_noturna:{ cron: '0 3 * * *' },
            ciclo_heuristico:   { cron: '*/15 * * * * *' },
            ciclo_ia:           { cron: '*/5 * * * *',   ativo: !!geminiKey }
        }
    });
});

router.get('/arquitetura', (_req, res) => {
    res.json({
        camadas: {
            apresentacao: {
                site_publico: '/index.html (catálogo + busca + WhatsApp)',
                dashboard:    '/dashboard.html (sala dos agentes + CRM + briefing)',
                console:      'bolinha flutuante ⚡ (consulta IA em qualquer aba)'
            },
            api: {
                leads:       '/api/leads',
                agenda:      '/api/agenda',
                imoveis:     '/api/imoveis',
                logs:        '/api/logs',
                config:      '/api/config',
                status:      '/api/status',
                ai:          '/api/ai',
                webhooks:    '/api/webhooks',
                agentes:     '/api/agentes',
                aprovacoes:  '/api/aprovacoes',
                cerebro:     '/api/cerebro',
                briefing:    '/api/briefing',
                sistema:     '/api/sistema'
            },
            agentes: {
                maestro:     'Igor — escaneia estado, decide via heurística (15s) e IA Gemini (5min)',
                sdr:         'Qualifica leads, follow_up, boas_vindas',
                financeiro:  'Categoriza transações, relatório DRE',
                designer:    'Gera artes / edita imagens',
                social:      'Cria posts, agenda no IG, responde DMs',
                pesquisa:    'Mercado + sugere imóveis do catálogo',
                atendimento: 'Pós-venda, documentação'
            },
            persistencia: {
                sqlite_db:   'igor.db (better-sqlite3)',
                tabelas:     ['leads', 'agenda', 'logs', 'config', 'integracoes', 'fila_tarefas', 'agentes', 'aprovacoes', 'imoveis', 'templates_automacao'],
                fotos_disco: 'public/assets/imoveis/<id>/<n>.jpg'
            },
            externos: {
                obsidian:    'OBSIDIAN_PATH (vault de markdown como contexto da IA)',
                z_api:       'WhatsApp (config: zapi_instancia + zapi_token)',
                n8n:         'Orquestração externa (webhook em /api/webhooks/n8n)',
                gemini:      'IA principal do Igor (gemini_api_key)',
                anthropic:   'Plug pronto, ainda não integrado',
                google_calendar: 'Sync via n8n (não direto)'
            }
        }
    });
});

// GET /api/sistema/ia-status — público. Mostra QUAIS provedores LLM estão configurados
// (sem expor as keys). Útil pra debug rápido quando skills retornam null.
router.get('/ia-status', (_req, res) => {
    const { getGroqKey, getGeminiKey, getAnthropicKey } = require('../agentes/ia');
    const groq = !!getGroqKey();
    const gemini = !!getGeminiKey();
    const anthropic = !!getAnthropicKey();
    res.json({
        groq, gemini, anthropic,
        algum_ativo: groq || gemini || anthropic,
        ordem_tentativa: 'groq -> gemini -> anthropic',
        modelo_groq: process.env.GROQ_MODEL_TEXT || 'llama-3.1-8b-instant',
    });
});

// GET /api/sistema/ia-teste — público. Faz 1 chamada direta a CADA provedor configurado
// e devolve resposta/erro de cada um. Custo: 1 token por provedor ativo. Crítico pra debug.
router.get('/ia-teste', async (_req, res) => {
    const { getGroqKey, getGeminiKey, getAnthropicKey } = require('../agentes/ia');
    const out = { groq: null, gemini: null, anthropic: null };

    if (getGroqKey()) {
        try {
            const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${getGroqKey()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: process.env.GROQ_MODEL_TEXT || 'llama-3.1-8b-instant',
                    messages: [{ role: 'user', content: 'PONG?' }],
                    max_tokens: 10,
                }),
            });
            const txt = await r.text();
            out.groq = { status: r.status, body: txt.slice(0, 400) };
        } catch (e) { out.groq = { erro: e.message }; }
    } else { out.groq = 'sem key'; }

    if (getGeminiKey()) {
        out.gemini = { status: 'configurada (não testada aqui)' };
    } else { out.gemini = 'sem key'; }

    if (getAnthropicKey()) {
        out.anthropic = { status: 'configurada (não testada aqui)' };
    } else { out.anthropic = 'sem key'; }

    res.json(out);
});

// POST /api/sistema/migrar — dispara migrador do catálogo em background.
// Protegido pelo middleware de auth global. Pode levar 5+ min pra completar (48 imóveis + downloads).
// Resposta imediata 202. Acompanhar em /api/sistema/migrar/status ou /api/logs?agente=sistema.
//
// Body opcional:
//   { skipExistentes: false }   // re-baixa tudo, mesmo o que já existe
//   { skipExistentes: true }    // default — só baixa novos (rápido)
router.post('/migrar', (req, res) => {
    const skipExistentes = req.body?.skipExistentes !== false;
    const { migrarTudo } = require('../migrator');

    setImmediate(() => {
        migrarTudo({ skipExistentes }).catch(err => {
            const { registrarLog } = require('../db');
            registrarLog({ agente: 'sistema', nivel: 'erro', mensagem: `migrar falhou: ${err.message}`, contexto: { stack: err.stack } });
        });
    });

    res.status(202).json({
        ok: true,
        mensagem: 'Migracao iniciada em background',
        acompanhar: '/api/sistema/migrar/status',
        opts: { skipExistentes }
    });
});

// Status rápido pra acompanhar progresso da migração
router.get('/migrar/status', (_req, res) => {
    const total = db.prepare('SELECT COUNT(*) AS n FROM imoveis').get().n;
    const ultimoLog = db.prepare(`
        SELECT mensagem, criado_em FROM logs
        WHERE agente='sistema' AND (mensagem LIKE '%igra%' OR mensagem LIKE '%catálogo%')
        ORDER BY criado_em DESC LIMIT 1
    `).get();
    const ultimoImovel = db.prepare(`
        SELECT titulo, importado_em FROM imoveis ORDER BY importado_em DESC LIMIT 1
    `).get();
    res.json({
        total_imoveis: total,
        ultimo_log: ultimoLog,
        ultimo_imovel_importado: ultimoImovel,
    });
});

// Sanitiza descricoes dos imoveis substituindo telefones/contatos do site original
// pelos do Igor. Roda em massa contra todas as descricoes existentes.
router.post('/sanitizar-descricoes', (_req, res) => {
    const fones = [
        /\+?55[\s.\-]?\(?48\)?[\s.\-]?9\s?9145[\s.\-]?0077/g,
        /\(?48\)?[\s.\-]?9\s?9145[\s.\-]?0077/g,
        /9\s?9145[\s.\-]?0077/g,
        /48991450077/g,
        /5548991450077/g,
    ];
    const FONE_NOVO = '(48) 9149-3622';
    const emailAntigo = /contato@imobiliariapraiadorosa\.com\.br/gi;
    const EMAIL_NOVO = 'contato@babolin.tech';

    const linhas = db.prepare('SELECT id, descricao FROM imoveis WHERE descricao IS NOT NULL').all();
    let alteradas = 0;
    const upd = db.prepare('UPDATE imoveis SET descricao = ? WHERE id = ?');
    const tx = db.transaction(() => {
        for (const l of linhas) {
            let nova = l.descricao;
            for (const r of fones) nova = nova.replace(r, FONE_NOVO);
            nova = nova.replace(emailAntigo, EMAIL_NOVO);
            if (nova !== l.descricao) {
                upd.run(nova, l.id);
                alteradas++;
            }
        }
    });
    tx();
    res.json({ ok: true, total: linhas.length, alteradas });
});

module.exports = router;
