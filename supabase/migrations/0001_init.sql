-- CharacterBot cloud data: bots, conversations, messages, memories, routines.
-- Never stores secrets (API keys, OAuth tokens, webhook keys, MCP env).
-- Every row belongs to a Supabase Auth user; RLS limits access to the owner.

create table public.bots (
  id text not null,
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  label text not null default '',
  color text not null default '',
  shape int not null default 0,
  system_prompt text not null default '',
  model text not null default '',
  updated_at timestamptz not null default now(),
  primary key (owner, id)
);

create table public.conversations (
  id text not null,
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('dm', 'group')),
  name text not null default '',
  bot_ids text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (owner, id)
);

create table public.messages (
  id text not null,
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  conv_id text not null,
  role text not null check (role in ('user', 'assistant', 'tool')),
  bot_id text,
  content text not null default '',
  name text,             -- tool name for tool entries
  thread_of text,
  ts timestamptz not null,
  primary key (owner, id),
  foreign key (owner, conv_id) references public.conversations (owner, id) on delete cascade
);
create index messages_conv_ts on public.messages (owner, conv_id, ts);

create table public.memories (
  id text not null,
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  bot_id text not null,
  text text not null,
  ts timestamptz not null default now(),
  primary key (owner, id),
  foreign key (owner, bot_id) references public.bots (owner, id) on delete cascade
);

create table public.routines (
  id text not null,
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  conv_id text not null,
  bot_id text not null,
  prompt text not null,
  schedule_type text not null check (schedule_type in ('interval', 'daily', 'webhook', 'file', 'github')),
  schedule_value text,   -- minutes / time / path / repo; never the webhook key
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (owner, id),
  foreign key (owner, conv_id) references public.conversations (owner, id) on delete cascade
);

do $$
declare t text;
begin
  foreach t in array array['bots', 'conversations', 'messages', 'memories', 'routines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "owner only" on public.%I for all to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()))', t);
  end loop;
end $$;
