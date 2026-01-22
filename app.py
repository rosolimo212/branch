import asyncio
import json
import os
from collections import defaultdict
from typing import Any, Optional

from aiohttp import web
from jinja2 import Environment, FileSystemLoader, select_autoescape

import storage

BASE_DIR = os.path.dirname(__file__)
TEMPLATES = Environment(
    loader=FileSystemLoader(os.path.join(BASE_DIR, "templates")),
    autoescape=select_autoescape(["html", "xml"]),
)

DOOR_PATH = os.getenv("DOOR_PATH", "").strip()
if not DOOR_PATH:
    raise RuntimeError("Set DOOR_PATH env var to a long, unguessable path segment.")
if not DOOR_PATH.startswith("/"):
    DOOR_PATH = "/" + DOOR_PATH

SIGNUP_PATH = os.getenv("SIGNUP_PATH", "").strip()
if not SIGNUP_PATH:
    raise RuntimeError("Set SIGNUP_PATH env var to a long, unguessable path segment.")
if not SIGNUP_PATH.startswith("/"):
    SIGNUP_PATH = "/" + SIGNUP_PATH

MAX_MESSAGE_LEN = int(os.getenv("MAX_MESSAGE_LEN", "2000"))
MAX_TOPIC_TITLE = int(os.getenv("MAX_TOPIC_TITLE", "80"))

ROOMS: dict[int, set[web.WebSocketResponse]] = defaultdict(set)


def render(template: str, **context: Any) -> web.Response:
    tpl = TEMPLATES.get_template(template)
    return web.Response(text=tpl.render(**context), content_type="text/html")


def safe_json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")


async def db_call(fn, *args):
    return await asyncio.to_thread(fn, *args)


def _cookie_secure(request: web.Request) -> bool:
    return request.scheme == "https"


async def get_user(request: web.Request) -> Optional[dict[str, Any]]:
    token = request.cookies.get("sid")
    if not token:
        return None
    row = await db_call(storage.get_user_by_session, token)
    if not row:
        return None
    return {"id": row["id"], "username": row["username"]}


async def index(request: web.Request) -> web.Response:
    return render("index.html", door_url=DOOR_PATH)


async def robots(request: web.Request) -> web.Response:
    return web.Response(
        text="User-agent: *\nDisallow: /\n", content_type="text/plain"
    )


async def login_form(request: web.Request) -> web.Response:
    return render("login.html", error=None)


async def login_submit(request: web.Request) -> web.Response:
    data = await request.post()
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    if not username or not password:
        return render("login.html", error="Missing credentials.")
    user = await db_call(storage.verify_user, username, password)
    if not user:
        return render("login.html", error="Wrong username or password.")
    token = await db_call(storage.create_session, user["id"])
    resp = web.HTTPFound("/lobby")
    resp.set_cookie(
        "sid",
        token,
        max_age=60 * 60 * 24 * 365,
        httponly=True,
        secure=_cookie_secure(request),
        samesite="Strict",
        path="/",
    )
    raise resp


async def signup_form(request: web.Request) -> web.Response:
    return render("signup.html", error=None)


async def signup_submit(request: web.Request) -> web.Response:
    data = await request.post()
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    confirm = data.get("confirm") or ""
    if not username or not password:
        return render("signup.html", error="Missing credentials.")
    if password != confirm:
        return render("signup.html", error="Passwords do not match.")
    if len(username) > 32:
        return render("signup.html", error="Username too long.")
    exists = await db_call(storage.user_exists, username)
    if exists:
        return render("signup.html", error="Username already exists.")
    await db_call(storage.create_user, username, password)
    resp = web.HTTPFound(DOOR_PATH)
    raise resp


async def logout(request: web.Request) -> web.Response:
    token = request.cookies.get("sid")
    if token:
        await db_call(storage.delete_session, token)
    resp = web.HTTPFound("/")
    resp.del_cookie("sid", path="/")
    raise resp


async def lobby(request: web.Request) -> web.Response:
    user = await get_user(request)
    if not user:
        raise web.HTTPNotFound()
    topics = await db_call(storage.list_topics)
    return render("lobby.html", topics=topics, user=user)


async def create_topic(request: web.Request) -> web.Response:
    user = await get_user(request)
    if not user:
        raise web.HTTPNotFound()
    data = await request.post()
    title = (data.get("title") or "").strip()
    if not title:
        return web.HTTPFound("/lobby")
    title = title[:MAX_TOPIC_TITLE]
    topic_id = await db_call(storage.create_topic, title, user["id"])
    raise web.HTTPFound(f"/topic/{topic_id}")


async def topic_page(request: web.Request) -> web.Response:
    user = await get_user(request)
    if not user:
        raise web.HTTPNotFound()
    topic_id = int(request.match_info["topic_id"])
    topic = await db_call(storage.get_topic, topic_id)
    if not topic:
        raise web.HTTPNotFound()
    messages = await db_call(storage.list_messages, topic_id)
    messages_json = safe_json([dict(row) for row in messages])
    user_json = safe_json(user)
    return render(
        "topic.html",
        topic=topic,
        messages_json=messages_json,
        user_json=user_json,
    )


async def ws_topic(request: web.Request) -> web.WebSocketResponse:
    user = await get_user(request)
    if not user:
        raise web.HTTPNotFound()
    topic_id = int(request.match_info["topic_id"])
    topic = await db_call(storage.get_topic, topic_id)
    if not topic:
        raise web.HTTPNotFound()

    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)
    ROOMS[topic_id].add(ws)

    try:
        async for msg in ws:
            if msg.type != web.WSMsgType.TEXT:
                continue
            try:
                data = json.loads(msg.data)
            except json.JSONDecodeError:
                continue

            if data.get("type") == "new_message":
                body = (data.get("body") or "").strip()
                if not body:
                    continue
                body = body[:MAX_MESSAGE_LEN]
                parent_id = data.get("parent_id")
                if parent_id is not None:
                    try:
                        parent_id = int(parent_id)
                    except ValueError:
                        parent_id = None
                row = await db_call(
                    storage.create_message,
                    topic_id,
                    parent_id,
                    user["id"],
                    body,
                )
                payload = {"type": "message", "message": dict(row)}
                await broadcast(topic_id, payload)

            elif data.get("type") == "react":
                message_id = data.get("message_id")
                value = data.get("value")
                if message_id is None or value not in (-1, 1):
                    continue
                try:
                    message_id = int(message_id)
                except ValueError:
                    continue
                row = await db_call(storage.set_reaction, message_id, user["id"], value)
                payload = {"type": "reaction", "message": dict(row)}
                await broadcast(topic_id, payload)
            elif data.get("type") == "edit_message":
                message_id = data.get("message_id")
                body = (data.get("body") or "").strip()
                if message_id is None or not body:
                    continue
                body = body[:MAX_MESSAGE_LEN]
                try:
                    message_id = int(message_id)
                except ValueError:
                    continue
                row = await db_call(storage.update_message, message_id, user["id"], body)
                if not row:
                    continue
                payload = {"type": "edit", "message": dict(row)}
                await broadcast(topic_id, payload)
    finally:
        ROOMS[topic_id].discard(ws)
    return ws


async def broadcast(topic_id: int, payload: dict[str, Any]) -> None:
    dead = []
    for ws in ROOMS[topic_id]:
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        ROOMS[topic_id].discard(ws)


async def not_found(request: web.Request) -> web.Response:
    resp = render("not_found.html")
    resp.set_status(404)
    return resp


def create_app() -> web.Application:
    storage.init_db()
    app = web.Application()
    app.router.add_get("/", index)
    app.router.add_get("/robots.txt", robots)
    app.router.add_get(DOOR_PATH, login_form)
    app.router.add_get(SIGNUP_PATH, signup_form)
    app.router.add_post("/login", login_submit)
    app.router.add_post("/signup", signup_submit)
    app.router.add_get("/logout", logout)
    app.router.add_get("/lobby", lobby)
    app.router.add_post("/topic/create", create_topic)
    app.router.add_get("/topic/{topic_id}", topic_page)
    app.router.add_get("/ws/topic/{topic_id}", ws_topic)
    app.router.add_static("/static", os.path.join(BASE_DIR, "static"))
    app.router.add_route("*", "/{tail:.*}", not_found)
    return app


def main() -> None:
    port = int(os.getenv("PORT", "8080"))
    app = create_app()
    web.run_app(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
