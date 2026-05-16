// REST API das skills sob demanda
// Lista, detalhe, criação manual, e execução direta via API
const express = require('express');
const { db } = require('../db');
const { listarSkills, buscarSkill, criarSkill, executarSkill } = require('../bot/skills');

const router = express.Router();

router.get('/', (req, res) => {
    const incluirInativas = req.query.incluir_inativas === 'true';
    const list = listarSkills(incluirInativas).map(s => ({
        ...s,
        matchers: (() => { try { return JSON.parse(db.prepare('SELECT matchers FROM skills WHERE id=?').get(s.id).matchers || '[]'); } catch { return []; } })()
    }));
    res.json({ total: list.length, skills: list });
});

router.get('/:slug', (req, res) => {
    const s = buscarSkill(req.params.slug);
    if (!s) return res.status(404).json({ erro: 'skill nao encontrada' });
    res.json(s);
});

router.post('/', (req, res) => {
    const { slug, nome, descricao, prompt_template, matchers } = req.body || {};
    if (!slug || !nome || !descricao || !prompt_template) {
        return res.status(400).json({ erro: 'campos obrigatorios: slug, nome, descricao, prompt_template' });
    }
    try {
        const r = criarSkill({ slug, nome, descricao, prompt_template, matchers: Array.isArray(matchers) ? matchers : [] });
        res.status(201).json(r);
    } catch (e) {
        if (e.message.includes('UNIQUE')) return res.status(409).json({ erro: `slug '${slug}' ja existe` });
        res.status(500).json({ erro: e.message });
    }
});

// POST /api/skills/:slug/executar { input, contexto? }
router.post('/:slug/executar', async (req, res, next) => {
    try {
        const { input, contexto } = req.body || {};
        const r = await executarSkill(req.params.slug, input || '', contexto || {});
        res.json(r);
    } catch (err) { next(err); }
});

// PATCH /api/skills/:slug { ativa?, descricao?, matchers?, prompt_template? }
router.patch('/:slug', (req, res) => {
    const s = db.prepare('SELECT id FROM skills WHERE slug = ?').get(req.params.slug);
    if (!s) return res.status(404).json({ erro: 'skill nao encontrada' });
    const campos = [];
    const valores = [];
    for (const k of ['nome', 'descricao', 'prompt_template']) {
        if (req.body[k] !== undefined) { campos.push(`${k} = ?`); valores.push(req.body[k]); }
    }
    if (req.body.ativa !== undefined) { campos.push('ativa = ?'); valores.push(req.body.ativa ? 1 : 0); }
    if (req.body.matchers !== undefined) { campos.push('matchers = ?'); valores.push(JSON.stringify(req.body.matchers)); }
    if (!campos.length) return res.status(400).json({ erro: 'nenhum campo pra atualizar' });
    campos.push('atualizada_em = datetime(\'now\')');
    db.prepare(`UPDATE skills SET ${campos.join(', ')} WHERE id = ?`).run(...valores, s.id);
    res.json({ ok: true });
});

// GET /api/skills/:slug/execucoes
router.get('/:slug/execucoes', (req, res) => {
    const s = db.prepare('SELECT id FROM skills WHERE slug = ?').get(req.params.slug);
    if (!s) return res.status(404).json({ erro: 'skill nao encontrada' });
    const rows = db.prepare(`
        SELECT id, entrada, output, sucesso, ms, criada_em
        FROM skill_execucoes
        WHERE skill_id = ?
        ORDER BY criada_em DESC LIMIT 20
    `).all(s.id);
    res.json({ total: rows.length, execucoes: rows });
});

module.exports = router;
