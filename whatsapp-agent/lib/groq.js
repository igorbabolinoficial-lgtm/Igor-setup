// Cerebro conversacional via Groq (Llama 3.3 70B versatile ou 8B instant).
// Fallback opcional pra Gemini.
import Groq from 'groq-sdk';
import { log } from './logger.js';

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

export async function chat(messages, options = {}) {
  if (!groq) throw new Error('GROQ_API_KEY ausente');

  const completion = await groq.chat.completions.create({
    model: options.model || MODEL,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens || 600,
    top_p: 0.9,
  });

  const text = completion.choices?.[0]?.message?.content?.trim() || '';
  log.debug('Groq response', { model: MODEL, tokens: completion.usage?.total_tokens });
  return text;
}
