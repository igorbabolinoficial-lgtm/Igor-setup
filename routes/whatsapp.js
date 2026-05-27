// routes/whatsapp.js — Proxy para o whatsapp-agent (Baileys).
// Expõe conversas e envio pro dashboard sem expor o token do wa-agent.
// Env vars necessárias no igor-neural-system:
//   WA_AGENT_URL   = URL do whatsapp-agent (ex: https://wa.babolin.tech)
//   WA_AGENT_TOKEN = mesmo valor de WEBHOOK_TOKEN do whatsapp-agent

const express = require('express');
const router = express.Router();

function waUrl()   { return process.env.WA_AGENT_URL; }
function waToken() { return process.env.WA_AGENT_TOKEN; }

async function wa(path, opts = {}) {
    const url   = waUrl();
    const token = waToken();
    if (!url || !token) {
        throw new Error('WA_AGENT_URL ou WA_AGENT_TOKEN não configurados no igor-neural-system');
    }
    const r = await fetch(`${url}${path}`, {
        method: opts.method || 'GET',
        headers: {
            'x-webhook-token': token,
            'Content-Type': 'application/json',
            ...(opts.headers || {}),
        },
        body: opts.body,
    });
    const text = await r.text();
    try { return JSON.parse(text); }
    catch { return { ok: false, raw: text }; }
}

// GET /api/whatsapp/status — estado da conexão Baileys
router.get('/status', async (req, res) => {
    try {
        const data = await wa('/status');
        res.json(data);
    } catch (e) {
        res.status(503).json({ ok: false, error: e.message });
    }
});

// GET /api/whatsapp/leads — lista leads com última mensagem (sidebar)
router.get('/leads', async (req, res) => {
    try {
        const data = await wa('/admin/leads');
        res.json(data);
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// GET /api/whatsapp/conversas/:phone — histórico de uma conversa
router.get('/conversas/:phone', async (req, res) => {
    try {
        const limit = req.query.limit || 100;
        const data = await wa(`/admin/conversas/${req.params.phone}?limit=${limit}`);
        res.json(data);
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// POST /api/whatsapp/send — envia mensagem pelo dashboard
router.post('/send', async (req, res) => {
    try {
        const { phone, text } = req.body || {};
        if (!phone || !text) return res.status(400).json({ error: 'phone e text obrigatórios' });
        const data = await wa('/send', {
            method: 'POST',
            body: JSON.stringify({ phone, text }),
        });
        res.json(data);
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// POST /api/whatsapp/sync-leads — importa leads do whatsapp-agent pro pipeline
router.post('/sync-leads', async (req, res) => {
    try {
        const { db, uid } = require('../db');
        const data = await wa('/admin/leads');
        const leads = data.leads || [];
        let criados = 0, atualizados = 0;
        for (const l of leads) {
            if (!l.phone) continue;
            const existente = db.prepare('SELECT id FROM leads WHERE telefone = ?').get(l.phone);
            if (existente) {
                // Atualiza nome e notas (última mensagem como contexto)
                const novaNotas = l.last_body ? l.last_body.slice(0, 120) : null;
                let mudou = false;
                if (l.name && l.name !== l.phone) {
                    db.prepare('UPDATE leads SET nome = ? WHERE id = ? AND (nome IS NULL OR nome = telefone)')
                      .run(l.name, existente.id);
                    mudou = true;
                }
                if (novaNotas) {
                    db.prepare('UPDATE leads SET notas = ? WHERE id = ?').run(novaNotas, existente.id);
                    mudou = true;
                }
                if (mudou) atualizados++;
            } else {
                const id = uid('lead');
                const nome = (l.name && l.name !== l.phone) ? l.name : l.phone;
                const notas = l.last_body ? l.last_body.slice(0, 120) : null;
                db.prepare(`INSERT INTO leads (id, nome, telefone, origem, status, score_ia, notas)
                            VALUES (?, ?, ?, 'whatsapp', 'novo_lead', 0, ?)`)
                  .run(id, nome, l.phone, notas);
                criados++;
            }
        }
        res.json({ ok: true, total: leads.length, criados, atualizados });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// POST /api/whatsapp/backfill-pipeline-status
// Lê as preferências salvas no wa-agent e atualiza o status dos leads no pipeline.
// Não regride status — só avança (novo_lead → em_atendimento → qualificado).
router.post('/backfill-pipeline-status', async (req, res) => {
    try {
        const { db: igorDb, nowIso, registrarLog } = require('../db');

        // 1. Busca leads + prefs do wa-agent
        const data = await wa('/admin/leads-prefs');
        const leads = data.leads || [];

        const ORDEM = { novo_lead: 0, em_atendimento: 1, qualificado: 2, convertido: 3, perdido: -1 };
        let movidos_atendimento = 0, movidos_qualificado = 0, ignorados = 0;

        for (const l of leads) {
            if (!l.phone) { ignorados++; continue; }

            // Calcula pontos da pipeline (mesma lógica do processBatch)
            const p = l.prefs || {};
            const nomeValido = l.name && !/^\d{8,}$/.test(l.name) ? l.name : null;
            const pontos = [p.tipo, p.finalidade, p.regiao, p.preco_max, p.pagamento, nomeValido]
                .filter(Boolean).length;
            const statusAlvo = pontos >= 4 ? 'qualificado' : 'em_atendimento';

            // Resolve phone com variantes
            const digits = String(l.phone).replace(/\D/g, '');
            const variantes = [digits];
            if (digits.startsWith('55')) variantes.push(digits.slice(2));
            else variantes.push('55' + digits);

            let lead = null;
            for (const v of variantes) {
                lead = igorDb.prepare('SELECT id, status, nome FROM leads WHERE telefone = ? OR telefone LIKE ?')
                    .get(v, `%${v}%`);
                if (lead) break;
            }
            if (!lead) { ignorados++; continue; }

            // Sempre atualiza pontos_pipeline (mesmo sem mudança de status)
            igorDb.prepare('UPDATE leads SET pontos_pipeline = ? WHERE id = ?').run(pontos, lead.id);

            // Não regride status
            if ((ORDEM[statusAlvo] ?? 0) <= (ORDEM[lead.status] ?? 0)) { ignorados++; continue; }

            const anterior = lead.status;
            igorDb.prepare('UPDATE leads SET status = ?, atualizado_em = ? WHERE id = ?')
                .run(statusAlvo, nowIso(), lead.id);
            registrarLog({
                agente: 'whatsapp', nivel: 'sucesso', template: 'qualificacao',
                mensagem: `Backfill: "${lead.nome}" ${anterior} → ${statusAlvo} (${pontos}/6 pontos)`,
                contexto: { lead_id: lead.id, de: anterior, para: statusAlvo, pontos, telefone: l.phone },
            });

            if (statusAlvo === 'qualificado') movidos_qualificado++;
            else movidos_atendimento++;
        }

        res.json({ ok: true, total: leads.length, movidos_atendimento, movidos_qualificado, ignorados });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// POST /api/whatsapp/takeover/set/:phone — para o bot nessa conversa
router.post('/takeover/set/:phone', async (req, res) => {
    try {
        const data = await wa(`/takeover/set/${req.params.phone}`, { method: 'POST', body: JSON.stringify({}) });
        res.json(data);
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// POST /api/whatsapp/takeover/release/:phone — reativa bot
router.post('/takeover/release/:phone', async (req, res) => {
    try {
        const data = await wa(`/takeover/release/${req.params.phone}`, { method: 'POST', body: JSON.stringify({}) });
        res.json(data);
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// GET /api/whatsapp/takeover/status/:phone
router.get('/takeover/status/:phone', async (req, res) => {
    try {
        const data = await wa(`/takeover/status/${req.params.phone}`);
        res.json(data);
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// GET /api/whatsapp/media/:filename — proxy binário para o whatsapp-agent
router.get('/media/:filename', async (req, res) => {
    try {
        const url   = waUrl();
        const token = waToken();
        if (!url || !token) return res.status(503).json({ error: 'WA_AGENT_URL ou WA_AGENT_TOKEN não configurados' });
        const r = await fetch(`${url}/media/${encodeURIComponent(req.params.filename)}`, {
            headers: { 'x-webhook-token': token },
        });
        if (!r.ok) return res.status(r.status).end();
        const ct = r.headers.get('content-type') || 'application/octet-stream';
        res.setHeader('Content-Type', ct);
        res.setHeader('Cache-Control', 'private, max-age=86400');
        const buf = await r.arrayBuffer();
        res.send(Buffer.from(buf));
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

module.exports = router;
