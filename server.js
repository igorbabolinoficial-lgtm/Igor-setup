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
