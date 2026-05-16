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

// ─── Basic Auth no admin (dashboard.html + APIs internas) ──────────────────────────
// Protege rotas sensíveis em produção. Bypass total se IGOR_ADMIN_USER/PASS não setados (dev).
// Whitelist sempre liberada:
//   - /api/ai/publica      (chatbot do site público)
//   - /api/saude           (healthcheck)
//   - /api/webhooks/*      (entradas externas autenticadas por segredo próprio)
//   - /escritorio/*        (assets do 3D, embed via iframe no dashboard.html)
//   - /                    (index.html do site público)
//   - /assets/*, /*.png/jpg/svg/css/js  (estáticos do site público)
const ADMIN_USER = process.env.IGOR_ADMIN_USER;
const ADMIN_PASS = process.env.IGOR_ADMIN_PASS;

function eRotaPublica(url) {
    if (url === '/' || url === '/index.html') return true;
    if (url.startsWith('/api/ai/publica')) return true;
    if (url === '/api/saude') return true;
    if (url.startsWith('/api/webhooks/')) return true;
    if (url.startsWith('/escritorio/')) return true;
    if (url.startsWith('/assets/')) return true;
    // Estáticos do site público (fotos de imóveis, css, js, favicons)
    if (/\.(png|jpe?g|gif|svg|webp|ico|css|mjs|map|woff2?|ttf|json)(\?.*)?$/i.test(url)) return true;
    return false;
}

function basicAuth(req, res, next) {
    // Sem credenciais setadas = modo dev, sem auth
    if (!ADMIN_USER || !ADMIN_PASS) return next();
    if (eRotaPublica(req.url)) return next();

    const header = req.headers.authorization || '';
    const [tipo, b64] = header.split(' ');
    if (tipo === 'Basic' && b64) {
        try {
            const [user, pass] = Buffer.from(b64, 'base64').toString('utf8').split(':');
            if (user === ADMIN_USER && pass === ADMIN_PASS) return next();
        } catch (_) {}
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="Igor Babolin Neural — admin"');
    return res.status(401).send('Autenticação necessária');
}

app.use(basicAuth);

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
