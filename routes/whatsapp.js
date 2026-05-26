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

module.exports = router;
