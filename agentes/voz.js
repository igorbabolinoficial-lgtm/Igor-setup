// Geração de voz via ElevenLabs TTS — pronto pra ser usado quando o WhatsApp Agentic do Igor
// estiver no ar (depois que Charles destravar Evolution API). Por enquanto serve pra preview manual
// via POST /api/voz/gerar.
//
// Cache local em /data/voz/cache/<hash>.mp3 pra não pagar 2x pela mesma síntese.
// Custo ElevenLabs: ~0.30 créditos por caractere no modelo multilingual.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { registrarLog } = require('../db');

const API_BASE = 'https://api.elevenlabs.io/v1';
const CACHE_DIR = path.join(process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : path.join(__dirname, '..'), 'voz', 'cache');

function getKey() {
    return process.env.ELEVENLABS_API_KEY || '';
}

function getDefaultVoice() {
    return process.env.ELEVENLABS_VOICE_ID || '';
}

function getDefaultModel() {
    // multilingual_v2 = melhor qualidade pt-BR. flash_v2 = mais barato/rápido.
    return process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
}

function temVoz() {
    return !!(getKey() && getDefaultVoice());
}

function hashKey(texto, voiceId, modelId) {
    return crypto.createHash('sha256').update(`${voiceId}|${modelId}|${texto}`).digest('hex');
}

function caminhoCache(texto, voiceId, modelId) {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    return path.join(CACHE_DIR, `${hashKey(texto, voiceId, modelId)}.mp3`);
}

// Gera áudio MP3 a partir de texto. Retorna Buffer ou null em falha.
// opts: { voiceId, modelId, stability, similarity, style, usarCache }
async function gerarAudio(texto, opts = {}) {
    if (!texto || typeof texto !== 'string') return null;
    const key = getKey();
    if (!key) return null;

    const voiceId = opts.voiceId || getDefaultVoice();
    if (!voiceId) return null;

    const modelId = opts.modelId || getDefaultModel();
    const usarCache = opts.usarCache !== false;

    // Cache hit — devolve mp3 do disco sem pagar
    if (usarCache) {
        const cache = caminhoCache(texto, voiceId, modelId);
        if (fs.existsSync(cache)) {
            return fs.readFileSync(cache);
        }
    }

    try {
        const r = await fetch(`${API_BASE}/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
                'xi-api-key': key,
                'Content-Type': 'application/json',
                'Accept': 'audio/mpeg',
            },
            body: JSON.stringify({
                text: texto,
                model_id: modelId,
                voice_settings: {
                    stability: opts.stability ?? 0.5,
                    similarity_boost: opts.similarity ?? 0.75,
                    style: opts.style ?? 0,
                    use_speaker_boost: true,
                },
            }),
        });
        if (!r.ok) {
            const txt = await r.text();
            registrarLog({
                agente: 'voz', nivel: 'erro',
                mensagem: `ElevenLabs ${r.status}`,
                contexto: { resposta: txt.slice(0, 200), voiceId, modelId },
            });
            return null;
        }
        const buf = Buffer.from(await r.arrayBuffer());
        if (usarCache && buf.length > 0) {
            try {
                fs.writeFileSync(caminhoCache(texto, voiceId, modelId), buf);
            } catch (err) {
                registrarLog({ agente: 'voz', nivel: 'alerta', mensagem: `cache write falhou: ${err.message}` });
            }
        }
        registrarLog({
            agente: 'voz', nivel: 'sucesso',
            mensagem: `Audio gerado (${buf.length} bytes, ${texto.length} chars)`,
            contexto: { voiceId, modelId, chars: texto.length },
        });
        return buf;
    } catch (err) {
        registrarLog({ agente: 'voz', nivel: 'erro', mensagem: `gerarAudio: ${err.message}` });
        return null;
    }
}

// Lista vozes disponíveis na conta (pra UI / debug)
async function listarVozes() {
    const key = getKey();
    if (!key) return null;
    try {
        const r = await fetch(`${API_BASE}/voices`, { headers: { 'xi-api-key': key } });
        if (!r.ok) return null;
        const data = await r.json();
        return (data.voices || []).map(v => ({
            voice_id: v.voice_id,
            name: v.name,
            category: v.category,
            description: v.description,
            preview_url: v.preview_url,
        }));
    } catch { return null; }
}

module.exports = { gerarAudio, listarVozes, temVoz };
