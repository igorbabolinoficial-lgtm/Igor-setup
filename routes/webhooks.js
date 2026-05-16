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

module.exports = router;
