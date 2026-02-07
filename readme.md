# Minimal Private Threads

Minimal web app with a 404-style landing page and a hidden login door. After login
you get a lobby of topics and infinitely branching text threads with realtime
updates. No external services, no tracking, and only one session cookie.

## Requirements

- Python 3.11+
- A long unguessable door path (env var)

## Quick start (local testing)

```bash
cd /home/roman/python/branch
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Set env vars:

```bash
export DOOR_PATH="door-$(python - <<'PY'
import secrets
print(secrets.token_urlsafe(18))
PY
)"
export PORT=8080
export ADMIN_USERS="alice"
```

Initialize DB and create a user:

```bash
python manage.py init-db
python manage.py create-user alice
```

Run the server:

```bash
python app.py
```

Open:
- `http://localhost:8080/` (landing page)
- `http://localhost:8080/$DOOR_PATH` (login)
- after login: `/lobby`
- admin page: `/admin` (only for usernames in `ADMIN_USERS`)

## Notes

- Login URL is unlisted but not truly secret; treat it like a private invite.
- One-time invite links are generated in `/admin`.
- No password recovery is implemented.
- Session persists for ~1 year unless you logout.