// Transcrição de audio do WhatsApp via Groq Whisper.
// WhatsApp envia audio em ogg/opus; Whisper aceita.
import Groq, { toFile } from 'groq-sdk';
import { log } from './logger.js';

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const MODEL = process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo';

function extFromMimetype(mt = '') {
  const m = mt.toLowerCase();
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('opus')) return 'ogg';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  if (m.includes('webm')) return 'webm';
  return 'ogg';
}

export async function transcribeAudio(buffer, mimetype) {
  if (!groq) throw new Error('GROQ_API_KEY ausente');
  if (!buffer || !buffer.length) throw new Error('Buffer de audio vazio');

  const ext = extFromMimetype(mimetype);
  const file = await toFile(buffer, `audio.${ext}`, { type: mimetype || 'audio/ogg' });

  const t0 = Date.now();
  const result = await groq.audio.transcriptions.create({
    file,
    model: MODEL,
    language: 'pt',
    response_format: 'json',
    temperature: 0,
  });
  const ms = Date.now() - t0;
  const text = (result?.text || '').trim();
  log.info('Audio transcrito', { model: MODEL, bytes: buffer.length, chars: text.length, ms });
  return text;
}
