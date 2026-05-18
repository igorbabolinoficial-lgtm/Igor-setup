// Storage SQLite local do wa-agent-igor. Substitui supabase do clone do Charles.
// Em prod (Coolify), DB_PATH aponta pra /data/wa-agent.db (volume persistente).
// Em dev, fallback pra ./wa-agent.db.

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'wa-agent.db');

const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS leads (
    id              TEXT PRIMARY KEY,
    phone           TEXT NOT NULL UNIQUE,
    name            TEXT,
    source          TEXT DEFAULT 'whatsapp',
    status          TEXT DEFAULT 'novo',
    whatsapp_status TEXT DEFAULT 'respondido',
    last_whatsapp_at TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    meta            TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id         TEXT REFERENCES leads(id),
    phone           TEXT NOT NULL,
    direction       TEXT NOT NULL,
    body            TEXT,
    waha_message_id TEXT UNIQUE,
    media_url       TEXT,
    status          TEXT,
    agent_response  INTEGER DEFAULT 0,
    meta            TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_msg_phone ON whatsapp_messages(phone, created_at);
CREATE INDEX IF NOT EXISTS idx_msg_lead ON whatsapp_messages(lead_id, created_at);
`);

// Normaliza telefone pra E.164 sem espacos/parenteses
// "(48) 99945-9527" => "5548999459527"
export function normalizePhone(raw) {
    if (!raw) return null;
    let digits = String(raw).replace(/\D/g, '');
    if (!digits) return null;
    if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
    return digits;
}

function uid(prefix = 'lead') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Helper: registra mensagem no DB (inbound ou outbound).
export async function saveMessage({ phone, direction, body, leadId, wahaMessageId, mediaUrl, status, agentResponse, meta }) {
    try {
        const result = db.prepare(`
            INSERT INTO whatsapp_messages (lead_id, phone, direction, body, waha_message_id, media_url, status, agent_response, meta)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            leadId || null,
            phone,
            direction,
            body || null,
            wahaMessageId || null,
            mediaUrl || null,
            status || (direction === 'in' ? 'received' : 'sent'),
            agentResponse ? 1 : 0,
            meta ? JSON.stringify(meta) : null
        );
        return { id: result.lastInsertRowid, phone, direction, body };
    } catch (e) {
        // dedup por waha_message_id (UNIQUE) — silencioso
        if (String(e.message).includes('UNIQUE constraint failed')) return null;
        throw e;
    }
}

export async function touchLead(leadId, patch = {}) {
    if (!leadId) return null;
    const sets = ['last_whatsapp_at = ?'];
    const vals = [new Date().toISOString()];
    if (patch.status)          { sets.push('status = ?');           vals.push(patch.status); }
    if (patch.whatsapp_status) { sets.push('whatsapp_status = ?');  vals.push(patch.whatsapp_status); }
    if (patch.name)            { sets.push('name = ?');             vals.push(patch.name); }
    vals.push(leadId);
    db.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
}

export async function findOrCreateLeadByPhone(phone, defaults = {}) {
    // tenta phone exato; se phone tem 55 prefix, tenta sem tambem
    const variants = [phone];
    if (phone && phone.startsWith('55')) variants.push(phone.slice(2));
    for (const v of variants) {
        const found = db.prepare('SELECT * FROM leads WHERE phone = ?').get(v);
        if (found) return found;
    }
    const id = uid();
    db.prepare(`
        INSERT INTO leads (id, phone, name, source, status, whatsapp_status)
        VALUES (?, ?, ?, ?, 'novo', 'respondido')
    `).run(id, phone, defaults.name || phone, defaults.source || 'whatsapp');
    return db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
}

// Pega historico recente da conversa (ultimas N mensagens) pro contexto do LLM.
// Devolve ordem cronologica (antiga -> nova).
export async function getRecentMessages(phone, limit = 12) {
    const rows = db.prepare(`
        SELECT direction, body, created_at FROM whatsapp_messages
        WHERE phone = ? ORDER BY created_at DESC LIMIT ?
    `).all(phone, limit);
    return rows.reverse();
}

// Compat: alguns lugares do clone esperam exportar 'supabase' como objeto.
// Stub que da erro claro se algo ainda usar.
export const supabase = new Proxy({}, {
    get() { throw new Error('supabase removido — use storage.js direto'); }
});

// Encaminha pro Igor neural-system pra aparecer no Kanban do dashboard.
// Best-effort: se falhar, nao quebra a conversa.
export async function syncLeadToIgor(lead, interesse) {
    const url = process.env.IGOR_LEAD_SYNC_URL;
    const token = process.env.IGOR_API_TOKEN;
    if (!url) return;
    try {
        await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'X-Agent-Token': token } : {}),
            },
            body: JSON.stringify({
                nome: lead.name || lead.phone,
                telefone: lead.phone,
                origem: 'whatsapp',
                interesse: interesse || 'whatsapp',
                notas: 'Lead capturado via WhatsApp (Igor agent)',
            }),
        });
    } catch (e) {
        // silencioso — o lead ja existe localmente
    }
}
