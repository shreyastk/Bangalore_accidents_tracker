# Bangalore Accidents Tracker: Supabase Handoff

## Current state

- Supabase Auth is used by the frontend for registration, login, sessions, and role checks.
- The browser uses only the Supabase anon key from `Frontend/js/bat-config.js`.
- The API and seed scripts use PostgreSQL. Set `SUPABASE_DATABASE_URL` to the Supabase transaction pooler URL so hosted Supabase is the source of truth.
- `Database/schema.sql` contains the accidents, hospitals, emergency alerts, PostGIS functions, indexes, and moderation helpers.
- The configured project currently has accident records and `get_accidents_fc`; run the schema before using hospital and alert features.

## One-time Supabase setup

1. In Supabase Dashboard, open **SQL Editor** and run `Database/schema.sql`. Re-run it after every pull — it's idempotent (`CREATE OR REPLACE FUNCTION`, `ADD COLUMN IF NOT EXISTS`) and picks up new RPCs such as `set_accident_geom`, used by `POST /api/reports` to save a user-submitted pin's coordinates.
2. In **Project Settings > Database > Connect**, copy the **Transaction pooler** URI.
3. Copy `server/.env.example` to `server/.env` and fill in the database password, project API values, and a private `ADMIN_SLUG`.
4. Create an admin user in **Authentication > Users**. There is no default admin username or password in this repository.
5. Set that user's `app_metadata.role` to `admin` using a trusted server-side Supabase Admin API script. Never put a service-role key in the frontend.

## Load and run

From `server/`:

```powershell
npm install
npm run seed
npm run seed:hospitals
npm start
```

The seed is idempotent for existing accident IDs and hospital IDs. The API then reads and writes the Supabase database, including user reports, moderation changes, emergency alerts, and analytics.

## Handoff checklist

- Keep `server/.env` out of source control and rotate any key that has been shared publicly.
- Give the next maintainer the Supabase project URL, repository, schema file, and deployment environment variables through a password manager.
- Keep the Supabase anon key in the frontend only; keep the service-role key and database URI on the server only.
- Configure Supabase Auth email confirmation and redirect URLs for the deployed frontend.