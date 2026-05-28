require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const { registrarLog } = require('./db');

const leadsRoutes    = require('./routes/leads');
const agendaRoutes   = require('./routes/agenda');
const logsRoutes     = require('./routes/logs');
const configRoutes   = require('./routes/config');
const statusRoutes   = require('./routes/status');
const aiRoutes       = require('./routes/ai');
const webhooksRoutes = require('./routes/webhooks');
const agentesRoutes    = require('./routes/agentes');
const aprovacoesRoutes = require('./routes/aprovacoes');
const cerebroRoutes    = require('./routes/cerebro').router;
const briefingRoutes   = require('./routes/briefing');
const imoveisRoutes    = require('./routes/imoveis');
const sistemaRoutes    = require('./routes/sistema');
const vozRoutes        = require('./routes/voz');
const skillsRoutes     = require('./routes/skills');
const metaAdsRoutes    = require('./routes/meta-ads');
const whatsappRoutes      = require('./routes/whatsapp');
const treinamentoRoutes   = require('./routes/treinamento');
const liveopsRoutes       = require('./routes/liveops');
const maestro          = require('./agentes/maestro');
const proativo         = require('./agentes/proativo');
const briefing         = require('./briefing');
const { iniciarBot }   = require('./bot');

const app = express();
const PORT = Number(process.env.PORT || 3003);

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use((req, _res, next) => {
    if (req.url.startsWith('/api')) {
        console.log(`[neural] ${req.method} ${req.url}`);
    }
    next();
});

// ─── Auth via cookie de sessão (substitui Basic Auth) ──────────────────────────────
// Protege rotas sensíveis em produção. Bypass total se IGOR_ADMIN_USER/PASS não setados (dev).
// Login bonito em /login.html, POST /api/auth/login, logout em /api/auth/logout.
// Cookie HttpOnly de 30 dias, assinado com HMAC SHA256 (SECRET derivado do PASS se não houver IGOR_AUTH_SECRET).
const crypto = require('crypto');
const ADMIN_USER = process.env.IGOR_ADMIN_USER;
const ADMIN_PASS = process.env.IGOR_ADMIN_PASS;
const AUTH_SECRET = process.env.IGOR_AUTH_SECRET || (ADMIN_USER && ADMIN_PASS ? crypto.createHash('sha256').update(`igor:${ADMIN_USER}:${ADMIN_PASS}`).digest('hex') : null);
const COOKIE_NAME = 'igor_session';
const COOKIE_DIAS = 30;

function eRotaPublica(pathname, method) {
    if (pathname === '/' || pathname === '/index.html') return true;
    if (pathname === '/login.html') return true;
    if (pathname === '/catalogo.html') return true;  // catálogo antigo do Igor preservado
    if (pathname === '/imovel.html') return true;
    if (pathname === '/sobre.html') return true;
    if (pathname === '/contato.html') return true;
    if (pathname === '/api/contato' && method === 'POST') return true;
    if (pathname.startsWith('/api/auth/')) return true;
    if (pathname.startsWith('/auth/google')) return true;  // OAuth Google (setup 1x)
    if (pathname.startsWith('/api/ai/publica')) return true;
    if (pathname === '/api/saude') return true;
    if (pathname === '/api/voz/status') return true;
    if (pathname === '/api/sistema/ia-status') return true;
    if (pathname === '/api/sistema/ia-teste') return true;
    if (pathname.startsWith('/api/webhooks/')) return true;
    if (pathname.startsWith('/api/imoveis') && method === 'GET') return true;
    if (pathname.startsWith('/escritorio/')) return true;
    if (pathname.startsWith('/showcase/')) return true;  // legado — antes do showcase virar home
    if (pathname.startsWith('/assets/')) return true;
    if (pathname.startsWith('/media/')) return true;
    if (pathname.startsWith('/models/')) return true;     // GLB/GLTF do showcase 3D
    if (pathname.startsWith('/textures/')) return true;   // texturas do showcase 3D
    if (/\.(png|jpe?g|gif|svg|webp|ico|css|mjs|map|woff2?|ttf|json|glb|gltf|fbx|dae|bin|hdr|exr)$/i.test(pathname)) return true;
    return false;
}

function gerarToken(user) {
    if (!AUTH_SECRET) return null;
    const payload = `${user}:${Date.now()}`;
    const sig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
    return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

function validarToken(token) {
    if (!token || !AUTH_SECRET) return null;
    try {
        const decoded = Buffer.from(token, 'base64url').toString('utf8');
        const parts = decoded.split(':');
        if (parts.length !== 3) return null;
        const [user, ts, sig] = parts;
        const esperado = crypto.createHmac('sha256', AUTH_SECRET).update(`${user}:${ts}`).digest('hex');
        if (sig !== esperado) return null;
        // expira em COOKIE_DIAS
        const idade = Date.now() - Number(ts);
        if (idade > COOKIE_DIAS * 86400 * 1000) return null;
        return { user };
    } catch (_) { return null; }
}

function parseCookies(req) {
    const cookie = req.headers.cookie || '';
    const out = {};
    for (const pair of cookie.split(';')) {
        const [k, ...v] = pair.trim().split('=');
        if (k) out[k] = v.join('=');
    }
    return out;
}

function authMiddleware(req, res, next) {
    if (!ADMIN_USER || !ADMIN_PASS) return next(); // dev mode
    // req.path = pathname sem querystring (req.url inclui ?next=... e quebra match estrito)
    if (eRotaPublica(req.path, req.method)) return next();

    // Bypass via X-Agent-Token (usado pelo whatsapp-agent e outros serviços internos)
    const AGENT_TOKEN = process.env.IGOR_AGENT_TOKEN;
    if (AGENT_TOKEN && req.headers['x-agent-token'] === AGENT_TOKEN) {
        return next();
    }

    const cookies = parseCookies(req);
    const sessao = validarToken(cookies[COOKIE_NAME]);
    if (sessao) return next();

    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ erro: 'Nao autenticado' });
    }
    // Anti-loop: nunca aponta next pra /login.html
    const destino = req.path === '/login.html' ? '/dashboard.html' : req.originalUrl;
    const next_param = encodeURIComponent(destino);
    return res.redirect(`/login.html?next=${next_param}`);
}

// Rotas de auth (sempre montadas, mesmo em dev)
app.post('/api/auth/login', (req, res) => {
    const { user, pass } = req.body || {};
    if (!ADMIN_USER || !ADMIN_PASS) return res.status(503).json({ erro: 'Auth nao configurada (env IGOR_ADMIN_USER/PASS)' });
    if (user !== ADMIN_USER || pass !== ADMIN_PASS) {
        return res.status(401).json({ erro: 'Credenciais invalidas' });
    }
    const token = gerarToken(user);
    const isProd = process.env.NODE_ENV === 'production';
    const flags = [
        `${COOKIE_NAME}=${token}`,
        `Max-Age=${COOKIE_DIAS * 86400}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
    ];
    if (isProd) flags.push('Secure');
    res.setHeader('Set-Cookie', flags.join('; '));
    res.json({ ok: true, user });
});

app.post('/api/auth/logout', (_req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
    res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
    if (!ADMIN_USER || !ADMIN_PASS) {
        return res.json({ auth_enabled: false, user: null });
    }
    const cookies = parseCookies(req);
    const sessao = validarToken(cookies[COOKIE_NAME]);
    res.json({ auth_enabled: true, user: sessao ? sessao.user : null });
});

// ─── OAuth Google (setup 1x — captura refresh_token) ──────────────────────────────
// Fluxo: Levi abre /auth/google → consente → Google redireciona p/ callback
// com code → callback troca por tokens e renderiza refresh_token p/ Levi copiar p/ env.
const googleLib = require('./lib/google');

app.get('/auth/google', (_req, res) => {
    try {
        const url = googleLib.getConsentUrl();
        res.redirect(url);
    } catch (err) {
        res.status(500).send(`<pre>Erro: ${err.message}\n\nVerifique GOOGLE_OAUTH_CLIENT_ID e GOOGLE_OAUTH_CLIENT_SECRET no .env</pre>`);
    }
});

app.get('/auth/google/callback', async (req, res) => {
    const { code, error } = req.query;
    if (error) return res.status(400).send(`<pre>Erro do Google: ${error}</pre>`);
    if (!code) return res.status(400).send('<pre>Faltando ?code= na URL</pre>');
    try {
        const tokens = await googleLib.exchangeCodeForTokens(code);
        if (!tokens.refresh_token) {
            return res.send(`
                <pre>Tokens recebidos, mas SEM refresh_token. Provavelmente esse usuario ja autorizou antes.
Solucoes:
  1. Vai em https://myaccount.google.com/permissions → Remove "Igor Babolin Bot" → tenta de novo
  2. Ou usa outro Google account no consent

Tokens recebidos:
${JSON.stringify(tokens, null, 2)}</pre>
            `);
        }
        res.send(`
            <html><body style="font-family: monospace; padding: 24px; background: #111; color: #eee;">
            <h1>OAuth Google OK</h1>
            <p>Copia o refresh_token abaixo e cola no Coolify do card <b>igor-neural-system</b>:</p>
            <h3>GOOGLE_OAUTH_REFRESH_TOKEN</h3>
            <textarea readonly style="width:100%; height:80px; padding:8px; background:#000; color:#0f0; font-size:14px;">${tokens.refresh_token}</textarea>
            <p>Tambem precisa setar no card <b>whatsapp-agent</b> a mesma var (se for usar chamadas Google direto de lá), ou deixar so no parent e o wa-agent chama via HTTP.</p>
            <hr>
            <p><b>Outros tokens (informativo):</b></p>
            <pre>${JSON.stringify({ ...tokens, refresh_token: '<<copiado acima>>' }, null, 2)}</pre>
            </body></html>
        `);
    } catch (err) {
        res.status(500).send(`<pre>Erro ao trocar code: ${err.message}\n\n${err.stack}</pre>`);
    }
});

app.use(authMiddleware);

// Em prod, fotos dos imóveis ficam no volume persistente /data/assets/imoveis.
// Express serve esse diretório sob o mesmo URL público /assets/imoveis (transparente pro frontend).
if (process.env.ASSETS_DIR) {
    app.use('/assets/imoveis', express.static(process.env.ASSETS_DIR));
}
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/leads',     leadsRoutes);
app.use('/api/agenda',    agendaRoutes);
app.use('/api/whatsapp',     whatsappRoutes);
app.use('/api/treinamento',  treinamentoRoutes);
app.use('/api/logs',      logsRoutes);
app.use('/api/config',    configRoutes);
app.use('/api/status',    statusRoutes);
app.use('/api/ai',        aiRoutes);
app.use('/api/webhooks',  webhooksRoutes);
app.use('/api/agentes',     agentesRoutes);
app.use('/api/aprovacoes',  aprovacoesRoutes);
app.use('/api/cerebro',     cerebroRoutes);
app.use('/api/briefing',    briefingRoutes);
app.use('/api/imoveis',     imoveisRoutes);
app.use('/api/sistema',     sistemaRoutes);
app.use('/api/voz',         vozRoutes);
app.use('/api/skills',      skillsRoutes);
app.use('/api/meta-ads',    metaAdsRoutes);
app.use('/api/liveops',     liveopsRoutes);

app.get('/api/saude', (_req, res) => res.json({ ok: true, projeto: 'igor-neural-system', versao: '0.1.0' }));

// Envio de email via Gmail do Igor (chamado pelo whatsapp-agent ou agentes internos)
// Auth: X-Agent-Token. Body: { to, subject, html, text, replyTo }
app.post('/api/email', async (req, res) => {
    try {
        const { to, subject, html, text, replyTo } = req.body || {};
        if (!to || !subject || (!html && !text)) {
            return res.status(400).json({ erro: 'to, subject e (html ou text) obrigatorios' });
        }
        if (!googleLib.isReady()) {
            return res.status(503).json({ erro: 'Google OAuth nao configurado no servidor' });
        }
        const r = await googleLib.gmail.sendEmail({ to, subject, html, text, replyTo });
        res.json(r);
    } catch (err) {
        console.error('[email] erro:', err.message);
        res.status(500).json({ erro: err.message });
    }
});

// Upload de midia pro Google Drive (chamado pelo whatsapp-agent quando lead manda foto/audio)
// Auth: X-Agent-Token (ja validado pelo authMiddleware)
// Body: { leadId, nome, mimeType, base64 }
app.post('/api/midia', async (req, res) => {
    try {
        const { leadId, nome, mimeType, base64 } = req.body || {};
        if (!nome || !mimeType || !base64) {
            return res.status(400).json({ erro: 'nome, mimeType e base64 obrigatorios' });
        }
        if (!googleLib.isReady()) {
            return res.status(503).json({ erro: 'Google OAuth nao configurado no servidor' });
        }
        const buffer = Buffer.from(base64, 'base64');
        const r = await googleLib.drive.uploadFile({ buffer, nome, mimeType, leadId });
        res.json({ ok: true, ...r });
    } catch (err) {
        console.error('[midia] erro:', err.message);
        res.status(500).json({ erro: err.message });
    }
});

// Formulario publico de contato (pagina /contato.html). Cria lead no funil.
app.post('/api/contato', async (req, res) => {
    const { nome, telefone, email, interesse, mensagem } = req.body || {};
    if (!nome || !telefone) return res.status(400).json({ erro: 'nome e telefone obrigatorios' });
    const { db, uid, registrarLog } = require('./db');
    const id = uid('lead');
    const origem = req.body?.origem || 'site_contato';
    const interesseTexto = interesse || origem;
    const notas = mensagem || null;
    db.prepare(`
        INSERT INTO leads (id, nome, interesse, telefone, email, origem, score_ia, notas)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `).run(id, nome, interesseTexto, telefone, email || null, origem, notas);
    registrarLog({
        agente: 'sdr', nivel: 'info',
        mensagem: `Novo contato (${origem}): ${nome}`,
        contexto: { lead_id: id, interesse: interesseTexto, origem }
    });
    // Best-effort: append na Sheet do Igor (se OAuth configurado)
    if (googleLib.isReady()) {
        googleLib.sheets.appendLead({
            nome, telefone, origem, interesse: interesseTexto, mensagem: notas || '',
        }).catch((err) => {
            console.error('[contato] Falha append Sheet:', err.message);
        });
    }
    res.json({ ok: true, lead_id: id });
});

app.use((err, _req, res, _next) => {
    console.error('[neural] erro:', err);
    registrarLog({
        agente: 'sistema',
        nivel: 'erro',
        mensagem: err.message || 'Erro desconhecido',
        contexto: { stack: err.stack }
    });
    res.status(err.status || 500).json({ erro: err.message || 'Erro interno' });
});

app.listen(PORT, () => {
    console.log(`\nIgor Neural System rodando em http://localhost:${PORT}`);
    console.log(`Dashboard: http://localhost:${PORT}/dashboard.html`);
    registrarLog({ agente: 'sistema', nivel: 'sucesso', mensagem: `Servidor iniciado na porta ${PORT}` });
    maestro.iniciar();
    briefing.iniciar();
    proativo.iniciar();
    iniciarBot().catch(err => console.error('[bot] erro fatal no iniciarBot:', err));
});
