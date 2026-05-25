const express = require('express');
const { db, uid, nowIso, registrarLog } = require('../db');

const router = express.Router();

function autenticar(req) {
    const segredoSalvo = (db.prepare('SELECT valor FROM config WHERE chave = ?').get('n8n_webhook_secret') || {}).valor
        || process.env.N8N_WEBHOOK_SECRET;
    if (!segredoSalvo) return true; // sem segredo configurado = aceita
    const recebido = req.get('x-webhook-secret') || req.query.secret;
    return recebido === segredoSalvo;
}

router.post('/n8n', (req, res) => {
    if (!autenticar(req)) return res.status(401).json({ erro: 'Segredo inválido' });

    const { evento, payload = {} } = req.body || {};
    if (!evento) return res.status(400).json({ erro: 'evento é obrigatório' });

    registrarLog({
        agente: 'sistema', nivel: 'info',
        mensagem: `Webhook n8n recebido: ${evento}`,
        contexto: { payload }
    });

    if (evento === 'novo_lead' && payload.nome) {
        const id = uid('lead');
        db.prepare(`
            INSERT INTO leads (id, nome, interesse, telefone, email, origem, score_ia, notas)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            payload.nome,
            payload.interesse,
            payload.telefone,
            payload.email,
            payload.origem || 'n8n',
            Number(payload.score_ia) || 0,
            payload.notas
        );
        registrarLog({
            agente: 'sdr', nivel: 'sucesso', template: 'boas_vindas',
            mensagem: `Lead criado via n8n: ${payload.nome}`,
            contexto: { lead_id: id }
        });
        return res.status(201).json({ ok: true, lead_id: id });
    }

    db.prepare('UPDATE integracoes SET status = ?, ultima_checagem = ? WHERE chave = ?')
        .run('online', nowIso(), 'n8n');

    res.json({ ok: true });
});

router.post('/whatsapp', (req, res) => {
    const { numero, mensagem, nome } = req.body || {};
    registrarLog({
        agente: 'sdr', nivel: 'info',
        mensagem: `WhatsApp de ${nome || numero || 'desconhecido'}: ${mensagem || '(vazio)'}`,
        contexto: { numero, mensagem, nome }
    });

    db.prepare('UPDATE integracoes SET status = ?, ultima_checagem = ? WHERE chave = ?')
        .run('online', nowIso(), 'whatsapp');

    if (numero && nome) {
        const existente = db.prepare('SELECT id FROM leads WHERE telefone = ?').get(numero);
        if (!existente) {
            const id = uid('lead');
            db.prepare(`
                INSERT INTO leads (id, nome, telefone, origem, notas)
                VALUES (?, ?, ?, 'whatsapp', ?)
            `).run(id, nome, numero, mensagem);
            registrarLog({
                agente: 'sdr', nivel: 'sucesso', template: 'boas_vindas',
                mensagem: `Lead criado via WhatsApp: ${nome}`,
                contexto: { lead_id: id, numero }
            });
        }
    }

    res.json({ ok: true });
});

// ─── META LEAD ADS ─────────────────────────────────────────────────────────────
// GET /api/webhooks/meta — verificação inicial exigida pelo Meta
// POST /api/webhooks/meta — recebe notificação de lead novo
//
// Env vars necessárias:
//   META_VERIFY_TOKEN       — string livre que você define (coloca igual no Meta)
//   META_PAGE_ACCESS_TOKEN  — Page Access Token do Meta Business Manager
//   WA_AGENT_URL            — URL interna do wa-agent (ex: http://localhost:3030)
//   WA_AGENT_TOKEN          — WEBHOOK_TOKEN do wa-agent

router.get('/meta', (req, res) => {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
    if (!VERIFY_TOKEN) {
        console.error('[meta] META_VERIFY_TOKEN nao configurado');
        return res.status(500).send('META_VERIFY_TOKEN ausente');
    }

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('[meta] Webhook verificado com sucesso');
        return res.status(200).send(challenge);
    }
    console.warn('[meta] Falha na verificacao', { mode, token });
    res.status(403).json({ erro: 'Token inválido' });
});

router.post('/meta', (req, res) => {
    // Meta exige resposta 200 em < 5s — responde antes de processar
    res.status(200).json({ ok: true });

    const body = req.body || {};
    if (body.object !== 'page') return;

    for (const entry of (body.entry || [])) {
        for (const change of (entry.changes || [])) {
            if (change.field !== 'leadgen') continue;
            const leadgenId = change.value?.leadgen_id;
            const pageId    = change.value?.page_id;
            if (!leadgenId) continue;

            console.log('[meta] Lead recebido', { leadgenId, pageId });
            processarMetaLead(leadgenId).catch((err) => {
                console.error('[meta] Falha processando lead', leadgenId, err.message);
            });
        }
    }
});

async function processarMetaLead(leadgenId) {
    const TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
    if (!TOKEN) {
        console.error('[meta] META_PAGE_ACCESS_TOKEN nao configurado — lead nao processado:', leadgenId);
        return;
    }

    // Busca dados do lead na Graph API do Meta
    const r = await fetch(`https://graph.facebook.com/v21.0/${leadgenId}?access_token=${TOKEN}`);
    if (!r.ok) {
        const txt = await r.text().catch(() => '');
        throw new Error(`Graph API HTTP ${r.status}: ${txt.slice(0, 200)}`);
    }
    const dados = await r.json();

    // Extrai campos do formulário (nomes variam por formulário)
    const campos = {};
    for (const f of (dados.field_data || [])) {
        campos[f.name.toLowerCase()] = (f.values || [])[0] || '';
    }

    const nome     = campos['full_name'] || campos['nome'] || campos['name'] || 'Lead Meta Ads';
    const telefone = normalizarTelefone(campos['phone_number'] || campos['telefone'] || campos['phone'] || '');
    const email    = campos['email'] || '';
    const interesse = campos['imovel'] || campos['interesse'] || campos['property'] || '';

    console.log('[meta] Dados extraídos', { nome, telefone, email, interesse });

    // Salva ou atualiza lead no DB
    let leadId;
    const existente = telefone ? db.prepare('SELECT id FROM leads WHERE telefone = ?').get(telefone) : null;
    if (existente) {
        leadId = existente.id;
        console.log('[meta] Lead já existe no DB', { leadId, telefone });
    } else {
        leadId = uid('lead');
        db.prepare(`
            INSERT INTO leads (id, nome, telefone, email, origem, interesse, notas)
            VALUES (?, ?, ?, ?, 'meta_ads', ?, ?)
        `).run(leadId, nome, telefone || null, email || null, interesse || null,
               `Meta Lead Ads · leadgen_id: ${leadgenId}`);

        registrarLog({
            agente: 'sdr', nivel: 'sucesso', template: 'boas_vindas',
            mensagem: `Novo lead via Meta Ads: ${nome}`,
            contexto: { lead_id: leadId, telefone, email, leadgenId }
        });
        console.log('[meta] Lead criado', { leadId, nome, telefone });
    }

    // Dispara WhatsApp se tiver telefone
    if (telefone) {
        await enviarBoasVindasWA(telefone, nome, leadId);
    } else {
        console.warn('[meta] Lead sem telefone — WhatsApp nao enviado', { nome, email });
    }
}

async function enviarBoasVindasWA(telefone, nome, leadId) {
    const WA_URL   = process.env.WA_AGENT_URL;
    const WA_TOKEN = process.env.WA_AGENT_TOKEN;

    if (!WA_URL || !WA_TOKEN) {
        console.warn('[meta] WA_AGENT_URL ou WA_AGENT_TOKEN ausentes — WhatsApp pulado');
        return;
    }

    const primeiroNome = nome.split(' ')[0];
    const texto = `Oi, ${primeiroNome}! Aqui é o Igor Babolin, corretor em Garopaba e Imbituba. Vi que você se interessou por um dos nossos imóveis — posso te ajudar com mais informações?`;

    const r = await fetch(`${WA_URL}/send`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-webhook-token': WA_TOKEN,
        },
        body: JSON.stringify({ phone: telefone, text: texto, leadId }),
    });

    if (!r.ok) {
        const txt = await r.text().catch(() => '');
        throw new Error(`WA agent HTTP ${r.status}: ${txt.slice(0, 200)}`);
    }
    console.log('[meta] WhatsApp de boas-vindas enviado', { telefone, nome });
}

function normalizarTelefone(tel) {
    const digits = String(tel || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('55') && digits.length >= 12) return digits;
    return `55${digits}`;
}

module.exports = router;
