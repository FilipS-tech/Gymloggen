# Gymloggen

Träningsapp för att bygga program, logga pass och följa progression.

- `site/` – själva webbappen (publiceras av Netlify, publish directory `site`, inget build-kommando)
- `supabase/functions/coach/` – AI-coachen (Supabase Edge Function, kräver secret `ANTHROPIC_API_KEY`)
