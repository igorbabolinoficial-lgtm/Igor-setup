const express = require('express');
const { db, uid } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
    const dias = Math.max(1, Math.min(60, Number(req.query.dias) || 7));
    const inicio = new Date();
    inicio.setHours(0, 0, 0, 0);
    const fim = new Date(inicio);
    fim.setDate(fim.getDate() + dias);

    const eventos = db.prepare(`
        SELECT a.*, l.nome AS lead_nome
        FROM agenda a
        LEFT JOIN leads l ON l.id = a.lead_id
        WHERE a.inicio >= ? AND a.inicio < ?
        ORDER BY a.inicio ASC
    `).all(inicio.toISOString(), fim.toISOString());

    res.json({ inicio: inicio.toISOString(), fim: fim.toISOString(), total: eventos.length, eventos });
});

router.post('/', (req, res) => {
    const { titulo, descricao, lead_id, inicio, fim, tipo = 'reuniao' } = req.body || {};
    if (!titulo || !inicio) return res.status(400).json({ erro: 'titulo e inicio são obrigatórios' });

    const id = uid('evt');
    db.prepare(`
        INSERT INTO agenda (id, titulo, descricao, lead_id, inicio, fim, tipo)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, titulo, descricao, lead_id, inicio, fim, tipo);

    res.status(201).json(db.prepare('SELECT * FROM agenda WHERE id = ?').get(id));
});

router.patch('/:id', (req, res) => {
    const evento = db.prepare('SELECT * FROM agenda WHERE id = ?').get(req.params.id);
    if (!evento) return res.status(404).json({ erro: 'Evento não encontrado' });

    const campos = ['titulo', 'descricao', 'lead_id', 'inicio', 'fim', 'tipo', 'status'];
    const sets = [];
    const params = [];
    for (const c of campos) {
        if (c in (req.body || {})) {
            sets.push(`${c} = ?`);
            params.push(req.body[c]);
        }
    }
    if (!sets.length) return res.json(evento);
    params.push(req.params.id);
    db.prepare(`UPDATE agenda SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    res.json(db.prepare('SELECT * FROM agenda WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM agenda WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
});

module.exports = router;
