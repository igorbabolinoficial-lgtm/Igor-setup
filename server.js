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
    if (pathname.startsWith('/api/auth/')) return true;
    if (pathname.startsWith('/api/ai/publica')) return true;
    if (pathname === '/api/saude') return true;
    if (pathname.startsWith('/api/webhooks/')) return true;
    // Catálogo de imóveis é público pra leitura (site do Igor mostra leads o catálogo).
    // Mutações (POST/PUT/PATCH/DELETE) ficam protegidas.
    if (pathname.startsWith('/api/imoveis') && method === 'GET') return true;
    if (pathname.startsWith('/escritorio/')) return true;
    if (pathname.startsWith('/assets/')) return true;
    // Fotos dos imóveis ficam em /media/* — público pro site mostrar
    if (pathname.startsWith('/media/')) return true;
    if (/\.(png|jpe?g|gif|svg|webp|ico|css|mjs|map|woff2?|ttf|json)$/i.test(pathname)) return true;
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

app.use(authMiddleware);

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/leads',     leadsRoutes);
app.use('/api/agenda',    agendaRoutes);
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

app.get('/api/saude', (_req, res) => res.json({ ok: true, projeto: 'igor-neural-system', versao: '0.1.0' }));

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
