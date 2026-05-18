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
    if (pathname.startsWith('/api/auth/')) return true;
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

// Em prod, fotos dos imóveis ficam no volume persistente /data/assets/imoveis.
// Express serve esse diretório sob o mesmo URL público /assets/imoveis (transparente pro frontend).
if (process.env.ASSETS_DIR) {
    app.use('/assets/imoveis', express.static(process.env.ASSETS_DIR));
}
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
app.use('/api/skills',      skillsRoutes);

app.get('/api/saude', (_req, res) => res.json({ ok: true, projeto: 'igor-neural-system', versao: '0.1.0' }));

// Dispara re-migração completa do sitemap imobiliariapraiadorosa.com.br.
// Roda em background; resposta imediata. Resultado vai pros logs.
let _migrarRodando = false;
app.post('/api/imoveis/migrar', async (_req, res) => {
    if (_migrarRodando) return res.status(409).json({ erro: 'Migração já em andamento' });
    _migrarRodando = true;
    res.status(202).json({ ok: true, mensagem: 'Migração iniciada. Acompanhe em /api/logs' });
    try {
        const { migrarTudo } = require('./migrator');
        const log = await migrarTudo({ skipExistentes: true });
        registrarLog({
            agente: 'sistema', nivel: 'sucesso',
            mensagem: `Migração manual: ${log.sucesso.length} ok, ${log.pulados.length} pulados`,
            contexto: { sucesso: log.sucesso.length, pulados: log.pulados.length }
        });
    } catch (e) {
        registrarLog({ agente: 'sistema', nivel: 'erro', mensagem: `Migração falhou: ${e.message}` });
    } finally {
        _migrarRodando = false;
    }
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
