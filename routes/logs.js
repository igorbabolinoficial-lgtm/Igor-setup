const express = require('express');
const { db, registrarLog } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
    const { agente, nivel, template, desde } = req.query;
    const limite = Math.max(1, Math.min(500, Number(req.query.limite) || 100));

    const where = [];
    const params = [];
    if (agente)   { where.push('agente = ?');   params.push(agente); }
    if (nivel)    { where.push('nivel = ?');    params.push(nivel); }
    if (template) { where.push('template = ?'); params.push(template); }
    if (desde)    { where.push('criado_em >= ?'); params.push(desde); }

    const sql = `
        SELECT * FROM logs
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY criado_em DESC
        LIMIT ?
    `;
    const linhas = db.prepare(sql).all(...params, limite);
    res.json({ total: linhas.length, logs: linhas });
});

router.get('/templates', (_req, res) => {
    const templates = db.prepare('SELECT * FROM templates_automacao ORDER BY ordem ASC').all();
    res.json({ total: templates.length, templates });
});

router.patch('/templates/:chave', (req, res) => {
    const tpl = db.prepare('SELECT * FROM templates_automacao WHERE chave = ?').get(req.params.chave);
    if (!tpl) return res.status(404).json({ erro: 'Template não encontrado' });
    if ('ativo' in (req.body || {})) {
        db.prepare('UPDATE templates_automacao SET ativo = ? WHERE chave = ?')
            .run(req.body.ativo ? 1 : 0, req.params.chave);
    }
    res.json(db.prepare('SELECT * FROM templates_automacao WHERE chave = ?').get(req.params.chave));
});

router.post('/', (req, res) => {
    const { agente = 'sistema', nivel = 'info', template, mensagem, contexto } = req.body || {};
    if (!mensagem) return res.status(400).json({ erro: 'mensagem obrigatória' });
    registrarLog({ agente, nivel, template, mensagem, contexto });
    res.status(201).json({ ok: true });
});

module.exports = router;
