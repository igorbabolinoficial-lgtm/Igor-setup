const express = require('express');
const { db, nowIso } = require('../db');

const router = express.Router();

const CHAVES_SENSIVEIS = new Set([
    'zapi_token', 'zapi_client_token', 'n8n_webhook_secret',
    'gemini_api_key', 'anthropic_api_key', 'openai_api_key'
]);

function mascarar(valor) {
    if (!valor) return '';
    if (valor.length <= 4) return '****';
    return `${'*'.repeat(Math.max(4, valor.length - 4))}${valor.slice(-4)}`;
}

router.get('/', (_req, res) => {
    const linhas = db.prepare('SELECT * FROM config').all();
    const out = {};
    for (const l of linhas) {
        out[l.chave] = {
            valor: l.sensivel ? mascarar(l.valor) : l.valor,
            sensivel: !!l.sensivel,
            atualizado_em: l.atualizado_em
        };
    }
    res.json(out);
});

router.post('/', (req, res) => {
    const entradas = req.body || {};
    const upsert = db.prepare(`
        INSERT INTO config (chave, valor, sensivel, atualizado_em)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em
    `);
    const tx = db.transaction((items) => {
        for (const [chave, valor] of Object.entries(items)) {
            const sensivel = CHAVES_SENSIVEIS.has(chave) ? 1 : 0;
            upsert.run(chave, valor == null ? null : String(valor), sensivel, nowIso());
        }
    });
    tx(entradas);
    res.json({ ok: true, salvos: Object.keys(entradas).length });
});

router.delete('/:chave', (req, res) => {
    db.prepare('DELETE FROM config WHERE chave = ?').run(req.params.chave);
    res.json({ ok: true });
});

module.exports = router;
