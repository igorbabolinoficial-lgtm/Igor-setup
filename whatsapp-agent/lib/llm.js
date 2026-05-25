// lib/llm.js — Facade unificada Groq | Gemini | Anthropic Claude.
// Permite trocar de provider via env LLM_PROVIDER sem mexer no codigo de conversa.
//
// Env vars:
//   LLM_PROVIDER=gemini | groq | anthropic   (default: groq pra compat)
//
//   GEMINI_API_KEY=...                       (https://aistudio.google.com/apikey)
//   GEMINI_MODEL=gemini-2.0-flash            (default; flash eh free tier mais generoso)
//
//   GROQ_API_KEY=...
//   GROQ_MODEL=llama-3.3-70b-versatile       (default)
//
//   ANTHROPIC_API_KEY=...
//   ANTHROPIC_MODEL=claude-haiku-4-5         (default; haiku eh barato)

import { log } from './logger.js';

const PROVIDER = (process.env.LLM_PROVIDER || 'groq').toLowerCase();

// === GROQ ===
let groqClient = null;
async function chatGroq(messages, options) {
  if (!groqClient) {
    const { default: Groq } = await import('groq-sdk');
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY ausente');
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  const model = options.model || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  const completion = await groqClient.chat.completions.create({
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens || 600,
    top_p: 0.9,
  });
  const text = completion.choices?.[0]?.message?.content?.trim() || '';
  log.debug('Groq response', { model, tokens: completion.usage?.total_tokens });
  return text;
}

// === GEMINI ===
let geminiClient = null;
async function chatGemini(messages, options) {
  if (!geminiClient) {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY ausente');
    geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  const modelName = options.model || process.env.GEMINI_MODEL || 'gemini-2.0-flash';

  // Gemini separa o "system instruction" do historico de mensagens
  const systemMsg = messages.find((m) => m.role === 'system');
  const conversa = messages.filter((m) => m.role !== 'system');

  // Formato Gemini: { role: 'user' | 'model', parts: [{ text }] }
  // "assistant" do OpenAI vira "model" no Gemini
  const contents = conversa.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content || '') }],
  }));

  const model = geminiClient.getGenerativeModel({
    model: modelName,
    systemInstruction: systemMsg ? systemMsg.content : undefined,
    generationConfig: {
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.maxTokens || 600,
      topP: 0.9,
    },
    // safetySettings frouxos pra nao bloquear conversas comerciais (mencao de valores, regiao, etc)
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
    ],
  });

  const result = await model.generateContent({ contents });
  const text = result.response.text()?.trim() || '';
  log.debug('Gemini response', { model: modelName, chars: text.length });
  return text;
}

// === ANTHROPIC CLAUDE ===
let anthropicClient = null;
async function chatAnthropic(messages, options) {
  if (!anthropicClient) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY ausente');
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  const modelName = options.model || process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';

  // Claude separa system do historico (igual Gemini)
  const systemMsg = messages.find((m) => m.role === 'system');
  const conversa = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || ''),
    }));

  // System como array com cache_control — desconto de 90% nos tokens cacheados (>=1024 tokens)
  const systemForRequest = systemMsg
    ? [{ type: 'text', text: systemMsg.content, cache_control: { type: 'ephemeral' } }]
    : undefined;

  const result = await anthropicClient.messages.create({
    model: modelName,
    system: systemForRequest,
    messages: conversa,
    max_tokens: options.maxTokens || 600,
    temperature: options.temperature ?? 0.7,
  });

  const textBlock = (result.content || []).find((b) => b.type === 'text');
  const text = textBlock?.text?.trim() || '';
  log.info('Anthropic response', {
    model: modelName,
    input: result.usage?.input_tokens,
    output: result.usage?.output_tokens,
    cache_read: result.usage?.cache_read_input_tokens,
    cache_create: result.usage?.cache_creation_input_tokens,
  });
  return text;
}

// === DISPATCH ===
export async function chat(messages, options = {}) {
  if (PROVIDER === 'gemini') return chatGemini(messages, options);
  if (PROVIDER === 'anthropic' || PROVIDER === 'claude') return chatAnthropic(messages, options);
  return chatGroq(messages, options);
}

export const providerAtivo = PROVIDER;
