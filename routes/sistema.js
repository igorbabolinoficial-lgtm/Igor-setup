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

module.exports = router;
