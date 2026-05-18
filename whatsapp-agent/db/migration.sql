-- Migration: WhatsApp Agentic do Charles
-- Roda 1x no SQL Editor do Supabase Dashboard (ou via supabase cli).

-- 1. Tabela de mensagens (historico bidirecional)
create table if not exists whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete set null,
  phone text not null,                       -- E.164 normalizado: +5548999999999
  direction text not null check (direction in ('in', 'out')),
  body text not null,
  media_url text,                            -- opcional (audio/img recebido)
  evolution_message_id text,                 -- id retornado pela Evolution API (pra dedup)
  status text default 'sent' check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'received')),
  agent_response boolean default false,      -- true se foi gerada pelo cerebro (groq)
  meta jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_whatsapp_messages_phone on whatsapp_messages(phone);
create index if not exists idx_whatsapp_messages_lead on whatsapp_messages(lead_id);
create index if not exists idx_whatsapp_messages_created on whatsapp_messages(created_at desc);
create unique index if not exists idx_whatsapp_messages_evolution_id
  on whatsapp_messages(evolution_message_id)
  where evolution_message_id is not null;

-- 2. Campos extras em `leads` pra fluxo WhatsApp
alter table leads add column if not exists whatsapp_status text
  default 'pendente'
  check (whatsapp_status in ('pendente', 'enviado', 'respondido', 'opt_out'));

alter table leads add column if not exists last_whatsapp_at timestamptz;
alter table leads add column if not exists whatsapp_session jsonb default '{}'::jsonb;
-- whatsapp_session: { last_topic, last_property_shown, name_confirmed, intent_detected, ... }

create index if not exists idx_leads_whatsapp_status on leads(whatsapp_status);

-- 3. View utilitaria: ultima mensagem por lead (pro dashboard /admin)
create or replace view leads_with_last_message as
select
  l.*,
  (select body from whatsapp_messages wm where wm.lead_id = l.id order by created_at desc limit 1) as last_message_body,
  (select direction from whatsapp_messages wm where wm.lead_id = l.id order by created_at desc limit 1) as last_message_direction,
  (select created_at from whatsapp_messages wm where wm.lead_id = l.id order by created_at desc limit 1) as last_message_at,
  (select count(*) from whatsapp_messages wm where wm.lead_id = l.id) as message_count
from leads l;
