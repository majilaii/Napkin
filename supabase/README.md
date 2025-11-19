# Supabase Edge Functions

This directory mirrors the structure used by the Supabase CLI so you can run
and deploy Edge Functions locally before promoting them to production.

## Pre-requisites

1. Install the [Supabase CLI](https://supabase.com/docs/guides/cli).
2. Copy `.env.example` to `.env` and populate the `FOURSQUARE_API_KEY` with your
   Places API key from the Foursquare developer portal.

```bash
cp supabase/.env.example supabase/.env
```

## Local development

From the repository root:

```bash
cd supabase
supabase functions serve foursquare-search --env-file .env
```

The CLI will expose the function at
`http://localhost:54321/functions/v1/foursquare-search`. The Expo app uses
`supabase.functions.invoke('foursquare-search', …)` so long as your
`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are configured.

### Example request

```bash
curl -X POST \
  http://localhost:54321/functions/v1/foursquare-search \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <anon-key-from-Supabase>' \
  -d '{"query":"ramen","near":"New York City"}'
```

## Deploying

When you're ready to release the proxy, authenticate the CLI with your Supabase
project and run:

```bash
supabase functions deploy foursquare-search --project-ref <project-ref>
```

From the Supabase dashboard, set the `FOURSQUARE_API_KEY` secret under
**Functions → Secrets** to ensure the function can reach Foursquare in
production.
