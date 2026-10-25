# Supabase (free tier) plan

PixelBot keeps everything in `state.json` on the Mac. Supabase adds an optional cloud copy so data survives a reinstall and can move between Macs.

## What is set up

- Free project `characterbot` in `ap-northeast-2` (Seoul).
- Schema: `supabase/migrations/0001_init.sql`. Tables `bots`, `conversations`, `messages`, `memories`, `routines`.
- Row Level Security on every table: a signed-in user only sees rows where `owner = auth.uid()`. The security advisor reports no issues.
- Claude Code has the Supabase MCP server registered at user scope (`claude mcp add supabase -s user …`). The access token lives in `~/.claude.json` only, never in this repo.

## What is never uploaded

API keys, OAuth tokens, `secrets.bin`, MCP server env, webhook keys, voice recordings and attachments. Only text that already shows in the UI.

## Next steps (not built yet)

1. Settings → "클라우드 백업": sign in with Supabase Auth (email magic link). The app ships only the project URL and the publishable anon key; RLS does the rest.
2. On each `save()`, upsert changed bots, conversations and messages (debounced). On a fresh install after sign-in, pull them into `state.json`.
3. Off by default. Turning it off stops syncing; a "클라우드 데이터 삭제" button deletes the user's rows.

## Free tier limits

500 MB database, 2 active projects, projects pause after 7 days without traffic (resume from the dashboard).
