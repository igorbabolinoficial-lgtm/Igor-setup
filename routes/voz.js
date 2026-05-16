// Endpoints de voz (ElevenLabs TTS). Hoje só preview manual via POST /api/voz/gerar.
// Quando WhatsApp Agentic estiver no ar, plug em agentes/social.js no fluxo responder_dm.

const express = require('express');
const { gerarAudio, listarVozes, temVoz } = require('../agentes/voz');

const router = express.Router();

// GET /api/voz/status
router.get('/status', (_req, res) => {
    res.json({
        ativo: temVoz(),
        voice_id: process.env.ELEVENLABS_VOICE_ID || null,
        modelo: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
    });
});

// GET /api/voz/vozes — lista vozes da conta
router.get('/vozes', async (_req, res, next) => {
    try {
        const lista = await listarVozes();
        if (!lista) return res.status(503).json({ erro: 'ElevenLabs nao configurado ou indisponivel' });
        res.json({ total: lista.length, vozes: lista });
    } catch (err) { next(err); }
});

// POST /api/voz/gerar { texto, voice_id? }
router.post('/gerar', async (req, res, next) => {
    try {
        const { texto, voice_id, model_id } = req.body || {};
        if (!texto || texto.length > 2000) {
            return res.status(400).json({ erro: 'texto e obrigatorio (1-2000 chars)' });
        }
        if (!temVoz()) {
            return res.status(503).json({ erro: 'ElevenLabs nao configurado. Setar ELEVENLABS_API_KEY e ELEVENLABS_VOICE_ID' });
        }
        const audio = await gerarAudio(texto, { voiceId: voice_id, modelId: model_id });
        if (!audio) return res.status(500).json({ erro: 'Falha ao gerar audio' });
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', audio.length);
        res.send(audio);
    } catch (err) { next(err); }
});

module.exports = router;
