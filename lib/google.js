// lib/google.js — Integração centralizada com Google APIs (Calendar, Sheets, Drive, Gmail).
// Auth: OAuth 2.0 com refresh token (conta Gmail pessoal do Igor, sem Workspace).
//
// Fluxo de setup (Levi faz uma vez):
//   1. Levi seta env vars: GOOGLE_OAUTH_CLIENT_ID, _CLIENT_SECRET, _REDIRECT_URI
//   2. Abre /auth/google → consent screen Google → callback retorna refresh_token
//   3. Levi cola refresh_token em GOOGLE_OAUTH_REFRESH_TOKEN no Coolify e redeploy
//   4. A partir daí, getOAuthClient() retorna client pronto com refresh automático

const { google } = require('googleapis');

const SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/gmail.send',
];

// === AUTH ===

function getOAuth2Client() {
    const { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI } = process.env;
    if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET) {
        throw new Error('Faltando GOOGLE_OAUTH_CLIENT_ID ou GOOGLE_OAUTH_CLIENT_SECRET no .env');
    }
    return new google.auth.OAuth2(
        GOOGLE_OAUTH_CLIENT_ID,
        GOOGLE_OAUTH_CLIENT_SECRET,
        GOOGLE_OAUTH_REDIRECT_URI || 'http://localhost:3003/auth/google/callback'
    );
}

// Cliente OAuth2 já com refresh_token setado, pronto pra fazer chamadas autenticadas.
// Usado por todas as funções de Calendar/Sheets/Drive/Gmail abaixo.
function getAuthenticatedClient() {
    const oauth2 = getOAuth2Client();
    const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
    if (!refreshToken) {
        throw new Error('Faltando GOOGLE_OAUTH_REFRESH_TOKEN. Faça /auth/google primeiro e cole o token no .env.');
    }
    oauth2.setCredentials({ refresh_token: refreshToken });
    return oauth2;
}

// Retorna true se as credenciais OAuth estão configuradas e parecem válidas.
// Usado pra fallback silencioso quando integração Google não está pronta.
function isReady() {
    return !!(process.env.GOOGLE_OAUTH_CLIENT_ID
        && process.env.GOOGLE_OAUTH_CLIENT_SECRET
        && process.env.GOOGLE_OAUTH_REFRESH_TOKEN);
}

// URL de consent screen pra Levi/Igor autorizar.
// access_type=offline + prompt=consent garante que retorna refresh_token (1x por usuário).
function getConsentUrl() {
    const oauth2 = getOAuth2Client();
    return oauth2.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: SCOPES,
        include_granted_scopes: true,
    });
}

// Troca code do callback por tokens (access_token + refresh_token).
async function exchangeCodeForTokens(code) {
    const oauth2 = getOAuth2Client();
    const { tokens } = await oauth2.getToken(code);
    return tokens;
}

// === CALENDAR ===

const calendar = {
    /**
     * Cria evento no Calendar.
     * @param {object} args
     * @param {string} args.titulo - Resumo do evento
     * @param {string} [args.descricao] - Descrição/corpo
     * @param {string} args.inicio - ISO 8601 (ex: '2026-05-23T14:00:00-03:00')
     * @param {string} args.fim - ISO 8601
     * @param {string[]} [args.convidados] - Emails dos convidados (lead, Igor, etc)
     * @param {string} [args.localizacao]
     * @returns {Promise<{id, htmlLink, hangoutLink}>}
     */
    async criarEvento({ titulo, descricao, inicio, fim, convidados = [], localizacao }) {
        const auth = getAuthenticatedClient();
        const cal = google.calendar({ version: 'v3', auth });
        const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

        const evento = {
            summary: titulo,
            description: descricao || '',
            start: { dateTime: inicio, timeZone: 'America/Sao_Paulo' },
            end: { dateTime: fim, timeZone: 'America/Sao_Paulo' },
            attendees: convidados.filter(Boolean).map((email) => ({ email })),
            location: localizacao || undefined,
            // Gera link do Meet automaticamente
            conferenceData: {
                createRequest: {
                    requestId: `igor-${Date.now()}`,
                    conferenceSolutionKey: { type: 'hangoutsMeet' },
                },
            },
            reminders: {
                useDefault: false,
                overrides: [
                    { method: 'popup', minutes: 60 },
                    { method: 'email', minutes: 24 * 60 },
                ],
            },
        };

        const res = await cal.events.insert({
            calendarId,
            requestBody: evento,
            conferenceDataVersion: 1,
            sendUpdates: convidados.length ? 'all' : 'none',
        });

        return {
            id: res.data.id,
            htmlLink: res.data.htmlLink,
            hangoutLink: res.data.hangoutLink || null,
        };
    },

    /**
     * Lista eventos num intervalo. Útil pra checar disponibilidade.
     */
    async listarEventos({ inicio, fim, limite = 50 }) {
        const auth = getAuthenticatedClient();
        const cal = google.calendar({ version: 'v3', auth });
        const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

        const res = await cal.events.list({
            calendarId,
            timeMin: inicio,
            timeMax: fim,
            maxResults: limite,
            singleEvents: true,
            orderBy: 'startTime',
        });
        return res.data.items || [];
    },
};

// === SHEETS ===

const sheets = {
    /**
     * Append uma linha de lead na sheet configurada via GOOGLE_SHEETS_LEADS_ID.
     * Schema esperado (linha 1 da sheet): data | nome | telefone | origem | interesse | mensagem
     * @returns {Promise<{ok, updatedRange}>}
     */
    async appendLead({ nome, telefone, origem, interesse, mensagem }) {
        const auth = getAuthenticatedClient();
        const sheetsApi = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.GOOGLE_SHEETS_LEADS_ID;
        if (!spreadsheetId) throw new Error('Faltando GOOGLE_SHEETS_LEADS_ID no .env');
        const range = process.env.GOOGLE_SHEETS_LEADS_RANGE || 'A:F';

        const dataIso = new Date().toISOString();
        const valores = [[
            dataIso,
            nome || '',
            telefone || '',
            origem || '',
            interesse || '',
            mensagem || '',
        ]];

        const res = await sheetsApi.spreadsheets.values.append({
            spreadsheetId,
            range,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: valores },
        });
        return { ok: true, updatedRange: res.data.updates?.updatedRange };
    },
};

// === DRIVE ===

const { Readable } = require('stream');

const drive = {
    /**
     * Upload de arquivo pra pasta configurada em GOOGLE_DRIVE_FOLDER_ID.
     * Cria subpasta por leadId se fornecido (organização básica).
     * @param {object} args
     * @param {Buffer} args.buffer
     * @param {string} args.nome - Nome do arquivo (com extensão)
     * @param {string} args.mimeType
     * @param {string} [args.leadId] - Se fornecido, agrupa em subpasta do lead
     * @returns {Promise<{fileId, webViewLink, webContentLink}>}
     */
    async uploadFile({ buffer, nome, mimeType, leadId }) {
        const auth = getAuthenticatedClient();
        const driveApi = google.drive({ version: 'v3', auth });
        const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
        if (!rootFolderId) throw new Error('Faltando GOOGLE_DRIVE_FOLDER_ID no .env');

        // Subpasta por lead (opcional, mas mantém Drive organizado)
        let parentId = rootFolderId;
        if (leadId) {
            parentId = await drive._ensureLeadFolder(driveApi, rootFolderId, leadId);
        }

        const res = await driveApi.files.create({
            requestBody: {
                name: nome,
                parents: [parentId],
            },
            media: {
                mimeType,
                body: Readable.from(buffer),
            },
            fields: 'id, webViewLink, webContentLink',
        });

        return {
            fileId: res.data.id,
            webViewLink: res.data.webViewLink,
            webContentLink: res.data.webContentLink || null,
        };
    },

    // Helper interno: garante subpasta com nome do leadId dentro da pasta raiz.
    async _ensureLeadFolder(driveApi, rootFolderId, leadId) {
        const nome = `lead_${leadId}`;
        const q = `name='${nome}' and '${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
        const list = await driveApi.files.list({ q, fields: 'files(id)' });
        if (list.data.files && list.data.files.length > 0) return list.data.files[0].id;

        const created = await driveApi.files.create({
            requestBody: {
                name: nome,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [rootFolderId],
            },
            fields: 'id',
        });
        return created.data.id;
    },
};

// === GMAIL ===

const gmail = {
    /**
     * Envia email via Gmail do usuario autenticado (GOOGLE_GMAIL_FROM).
     * @param {object} args
     * @param {string|string[]} args.to
     * @param {string} args.subject
     * @param {string} [args.html] - Corpo HTML (preferido)
     * @param {string} [args.text] - Corpo texto plano (fallback)
     * @param {string} [args.replyTo]
     * @returns {Promise<{ok, messageId}>}
     */
    async sendEmail({ to, subject, html, text, replyTo }) {
        const auth = getAuthenticatedClient();
        const gmailApi = google.gmail({ version: 'v1', auth });
        const from = process.env.GOOGLE_GMAIL_FROM;
        if (!from) throw new Error('Faltando GOOGLE_GMAIL_FROM no .env');

        const toStr = Array.isArray(to) ? to.join(', ') : to;
        const contentType = html ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8';
        const body = html || text || '';

        const linhas = [
            `From: ${from}`,
            `To: ${toStr}`,
            `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
            `Content-Type: ${contentType}`,
            'MIME-Version: 1.0',
        ];
        if (replyTo) linhas.push(`Reply-To: ${replyTo}`);
        linhas.push('', body);
        const mime = linhas.join('\r\n');

        const raw = Buffer.from(mime).toString('base64')
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        const res = await gmailApi.users.messages.send({
            userId: 'me',
            requestBody: { raw },
        });
        return { ok: true, messageId: res.data.id };
    },
};

module.exports = {
    SCOPES,
    isReady,
    getConsentUrl,
    exchangeCodeForTokens,
    calendar,
    sheets,
    drive,
    gmail,
};
