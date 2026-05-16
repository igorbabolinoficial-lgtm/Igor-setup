// Wrapper IA unificado: Groq primário (free tier generoso), Gemini secundário, Anthropic fallback.
// Todos os agentes/rotinas devem chamar gerarTexto() em vez de instanciar SDKs direto.
//
// Histórico: começou como Gemini→Anthropic. Trocado pra Groq primário em 2026-05-16
// pelo mesmo motivo que motivou a troca no LMP — estouro de cota Gemini quebrava o pipeline
// de produção. Groq tem free tier de ~30 req/min sem custo.
const { db, registrarLog } = require('../db');

let GoogleGenerativeAI;
try { ({ GoogleGenerativeAI } = require('@google/generative-ai')); } catch (_) {}

let Anthropic;
try { Anthropic = require('@anthropic-ai/sdk'); } catch (_) {}

function getKey(chave, envVar) {
    const cfg = db.prepare('SELECT valor FROM config WHERE chave = ?').get(chave);
    return (cfg && cfg.valor) || process.env[envVar] || '';
}

function getGroqKey()      { return getKey('groq_api_key', 'GROQ_API_KEY'); }
function getGeminiKey()    { return getKey('gemini_api_key', 'GEMINI_API_KEY'); }
function getAnthropicKey() { return getKey('anthropic_api_key', 'ANTHROPIC_API_KEY'); }

// Groq via API OpenAI-compatible — sem SDK pra evitar dependência extra.
async function tentarGroq(prompt) {
    const apiKey = getGroqKey();
    if (!apiKey) throw new Error('groq_indisponivel');
    const modelo = process.env.GROQ_MODEL_TEXT || 'llama-3.1-8b-instant';
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: modelo,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 2048,
        }),
    });
    if (!r.ok) {
        const txt = await r.text();
        throw new Error(`groq_http_${r.status}: ${txt.slice(0, 200)}`);
    }
    const data = await r.json();
    const texto = data?.choices?.[0]?.message?.content || '';
    if (!texto) throw new Error('groq_resposta_vazia');
    return texto;
}

async function tentarGemini(prompt) {
    const apiKey = getGeminiKey();
    if (!apiKey || !GoogleGenerativeAI) throw new Error('gemini_indisponivel');
    const ai = new GoogleGenerativeAI(apiKey);
    const model = ai.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const r = await model.generateContent(prompt);
    return r.response.text();
}

async function tentarAnthropic(prompt) {
    const apiKey = getAnthropicKey();
    if (!apiKey || !Anthropic) throw new Error('anthropic_indisponivel');
    const client = new Anthropic({ apiKey });
    const r = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }]
    });
    const bloco = r.content.find(c => c.type === 'text');
    return bloco ? bloco.text : '';
}

// Ordem padrão: Groq → Gemini → Anthropic. opts.preferirAnthropic inverte pra Anthropic primeiro.
async function gerarTexto(prompt, opts = {}) {
    const erros = [];
    const tentativas = opts.preferirAnthropic
        ? [['anthropic', tentarAnthropic], ['groq', tentarGroq], ['gemini', tentarGemini]]
        : [['groq', tentarGroq], ['gemini', tentarGemini], ['anthropic', tentarAnthropic]];

    for (const [modelo, fn] of tentativas) {
        try {
            const texto = await fn(prompt);
            if (texto && texto.trim()) return { texto: texto.trim(), modelo };
        } catch (err) {
            erros.push(`${modelo}: ${err.message}`);
        }
    }

    registrarLog({
        agente: 'sistema', nivel: 'alerta',
        mensagem: 'Nenhum LLM disponível para gerar texto',
        contexto: { erros }
    });
    return null;
}

// Transcreve áudio via Groq Whisper (free tier). Recebe Buffer + nome do arquivo.
// Retorna texto ou null em falha.
async function transcreverAudio(audioBuffer, filename = 'audio.ogg') {
    const apiKey = getGroqKey();
    if (!apiKey) return null;
    const modelo = process.env.GROQ_MODEL_AUDIO || 'whisper-large-v3-turbo';

    const form = new FormData();
    const blob = new Blob([audioBuffer], { type: 'audio/ogg' });
    form.append('file', blob, filename);
    form.append('model', modelo);
    form.append('language', 'pt');

    try {
        const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: form,
        });
        if (!r.ok) {
            const txt = await r.text();
            registrarLog({ agente: 'sistema', nivel: 'alerta', mensagem: `Whisper falhou: ${r.status} ${txt.slice(0, 150)}` });
            return null;
        }
        const data = await r.json();
        return data?.text || null;
    } catch (err) {
        registrarLog({ agente: 'sistema', nivel: 'erro', mensagem: `transcrever áudio: ${err.message}` });
        return null;
    }
}

function extrairJson(texto) {
    if (!texto) return null;
    const m = texto.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch (_) { return null; }
}

function temAlgumLLM() {
    return !!(getGroqKey() || getGeminiKey() || getAnthropicKey());
}

module.exports = {
    gerarTexto,
    transcreverAudio,
    extrairJson,
    temAlgumLLM,
    getGroqKey,
    getGeminiKey,
    getAnthropicKey,
};
