const express = require('express');
const { db, uid } = require('../db');
const googleLib = require('../lib/google');

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

router.post('/', async (req, res) => {
    const { titulo, descricao, lead_id, lead_phone, inicio, fim, tipo = 'reuniao', convidados, localizacao, cancelar_anterior_event_id } = req.body || {};
    if (!titulo || !inicio) return res.status(400).json({ erro: 'titulo e inicio são obrigatórios' });

    // Resolve lead_id por telefone se nao veio direto (caso comum do wa-agent)
    let leadIdResolvido = lead_id;
    if (!leadIdResolvido && lead_phone) {
        // Tenta variantes do telefone (com/sem 55, com/sem 9 inicial)
        const digits = String(lead_phone).replace(/\D/g, '');
        const variantes = [digits];
        if (digits.startsWith('55')) variantes.push(digits.slice(2));
        else variantes.push('55' + digits);
        for (const v of variantes) {
            const lead = db.prepare('SELECT id FROM leads WHERE telefone = ? OR telefone LIKE ?').get(v, `%${v}%`);
            if (lead) { leadIdResolvido = lead.id; break; }
        }
    }

    // Se foi passado um event_id anterior, cancela antes de criar o novo (remarcacao)
    let canceladoAnterior = null;
    if (cancelar_anterior_event_id && googleLib.isReady()) {
        try {
            await googleLib.calendar.cancelarEvento(cancelar_anterior_event_id);
            canceladoAnterior = { ok: true, event_id: cancelar_anterior_event_id };
            db.prepare(`UPDATE agenda SET status = 'cancelado' WHERE google_event_id = ?`).run(cancelar_anterior_event_id);
        } catch (err) {
            console.error('[agenda] Falha ao cancelar evento anterior:', err.message);
            canceladoAnterior = { ok: false, error: err.message };
        }
    }

    // Defesa anti-duplicata: cancela TODOS eventos futuros pendentes do mesmo lead
    // (cobre o caso de LID mudar e cancelar_anterior_event_id ter vindo nulo)
    const canceladosAuto = [];
    if (leadIdResolvido) {
        const pendentes = db.prepare(`
            SELECT id, google_event_id, inicio, titulo FROM agenda
            WHERE lead_id = ? AND status = 'agendado' AND inicio >= datetime('now', '-1 hour')
        `).all(leadIdResolvido);
        for (const p of pendentes) {
            if (p.google_event_id && googleLib.isReady()) {
                try {
                    await googleLib.calendar.cancelarEvento(p.google_event_id);
                    canceladosAuto.push({ id: p.id, google_event_id: p.google_event_id, titulo: p.titulo });
                } catch (err) {
                    console.error('[agenda] Falha auto-cancelar:', err.message);
                }
            }
            db.prepare(`UPDATE agenda SET status = 'cancelado' WHERE id = ?`).run(p.id);
        }
    }

    const id = uid('evt');
    db.prepare(`
        INSERT INTO agenda (id, titulo, descricao, lead_id, inicio, fim, tipo)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, titulo, descricao, leadIdResolvido, inicio, fim, tipo);

    // Best-effort: criar evento no Google Calendar (se OAuth configurado)
    let googleSync = null;
    if (googleLib.isReady() && (tipo === 'reuniao' || tipo === 'ligacao')) {
        try {
            // Se nao tem fim, assume 1h de duracao (padrao pra visita)
            const fimReal = fim || new Date(new Date(inicio).getTime() + 60 * 60 * 1000).toISOString();
            const ev = await googleLib.calendar.criarEvento({
                titulo,
                descricao: descricao || '',
                inicio,
                fim: fimReal,
                convidados: Array.isArray(convidados) ? convidados : [],
                localizacao,
            });
            db.prepare(`
                UPDATE agenda SET google_event_id = ?, google_event_link = ?, google_meet_link = ? WHERE id = ?
            `).run(ev.id, ev.htmlLink, ev.hangoutLink, id);
            googleSync = { ok: true, event_id: ev.id, link: ev.htmlLink, meet: ev.hangoutLink };
        } catch (err) {
            console.error('[agenda] Falha ao criar evento no Google Calendar:', err.message);
            googleSync = { ok: false, error: err.message };
        }
    }

    const evento = db.prepare('SELECT * FROM agenda WHERE id = ?').get(id);
    res.status(201).json({ ...evento, google_sync: googleSync, cancelado_anterior: canceladoAnterior, cancelados_auto: canceladosAuto });
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
