import datetime
import hashlib
import os
import secrets
import sqlite3
from typing import Optional

BASE_DIR = os.path.dirname(__file__)
DB_PATH = os.getenv("DB_PATH", os.path.join(BASE_DIR, "data.db"))


def _now() -> str:
    return datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db() -> None:
    conn = _connect()
    cur = conn.cursor()
    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            password_salt TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            last_seen TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS topics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            created_by INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            topic_id INTEGER NOT NULL,
            parent_id INTEGER,
            user_id INTEGER NOT NULL,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
            FOREIGN KEY (parent_id) REFERENCES messages(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS reactions (
            message_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            value INTEGER NOT NULL CHECK (value IN (-1, 1)),
            created_at TEXT NOT NULL,
            PRIMARY KEY (message_id, user_id),
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_messages_topic ON messages(topic_id);
        CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_id);
        """
    )
    conn.commit()
    conn.close()


def _hash_password(password: str, salt_hex: str) -> str:
    salt = bytes.fromhex(salt_hex)
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000)
    return hashed.hex()


def create_user(username: str, password: str) -> None:
    salt = secrets.token_bytes(16).hex()
    pwd_hash = _hash_password(password, salt)
    conn = _connect()
    conn.execute(
        "INSERT INTO users (username, password_hash, password_salt, created_at) "
        "VALUES (?, ?, ?, ?)",
        (username, pwd_hash, salt, _now()),
    )
    conn.commit()
    conn.close()


def verify_user(username: str, password: str) -> Optional[sqlite3.Row]:
    conn = _connect()
    row = conn.execute(
        "SELECT id, username, password_hash, password_salt FROM users WHERE username = ?",
        (username,),
    ).fetchone()
    conn.close()
    if not row:
        return None
    pwd_hash = _hash_password(password, row["password_salt"])
    if secrets.compare_digest(pwd_hash, row["password_hash"]):
        return row
    return None


def create_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    conn = _connect()
    conn.execute(
        "INSERT INTO sessions (token, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)",
        (token, user_id, _now(), _now()),
    )
    conn.commit()
    conn.close()
    return token


def get_user_by_session(token: str) -> Optional[sqlite3.Row]:
    conn = _connect()
    row = conn.execute(
        "SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.token = ?",
        (token,),
    ).fetchone()
    if row:
        conn.execute("UPDATE sessions SET last_seen = ? WHERE token = ?", (_now(), token))
        conn.commit()
    conn.close()
    return row


def delete_session(token: str) -> None:
    conn = _connect()
    conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
    conn.commit()
    conn.close()


def list_topics() -> list[sqlite3.Row]:
    conn = _connect()
    rows = conn.execute(
        "SELECT t.id, t.title, t.created_at, u.username as author "
        "FROM topics t JOIN users u ON u.id = t.created_by "
        "ORDER BY t.created_at DESC"
    ).fetchall()
    conn.close()
    return rows


def get_topic(topic_id: int) -> Optional[sqlite3.Row]:
    conn = _connect()
    row = conn.execute(
        "SELECT t.id, t.title, t.created_at, u.username as author "
        "FROM topics t JOIN users u ON u.id = t.created_by "
        "WHERE t.id = ?",
        (topic_id,),
    ).fetchone()
    conn.close()
    return row


def create_topic(title: str, user_id: int) -> int:
    conn = _connect()
    cur = conn.execute(
        "INSERT INTO topics (title, created_by, created_at) VALUES (?, ?, ?)",
        (title, user_id, _now()),
    )
    conn.commit()
    topic_id = cur.lastrowid
    conn.close()
    return int(topic_id)


def list_messages(topic_id: int) -> list[sqlite3.Row]:
    conn = _connect()
    rows = conn.execute(
        """
        SELECT m.id,
               m.topic_id,
               m.parent_id,
               m.body,
               m.created_at,
               u.username,
               COALESCE(SUM(CASE WHEN r.value = 1 THEN 1 END), 0) AS likes,
               COALESCE(SUM(CASE WHEN r.value = -1 THEN 1 END), 0) AS dislikes
        FROM messages m
        JOIN users u ON u.id = m.user_id
        LEFT JOIN reactions r ON r.message_id = m.id
        WHERE m.topic_id = ?
        GROUP BY m.id
        ORDER BY m.created_at ASC
        """,
        (topic_id,),
    ).fetchall()
    conn.close()
    return rows


def get_message(message_id: int) -> Optional[sqlite3.Row]:
    conn = _connect()
    row = conn.execute(
        """
        SELECT m.id,
               m.topic_id,
               m.parent_id,
               m.body,
               m.created_at,
               u.username,
               COALESCE(SUM(CASE WHEN r.value = 1 THEN 1 END), 0) AS likes,
               COALESCE(SUM(CASE WHEN r.value = -1 THEN 1 END), 0) AS dislikes
        FROM messages m
        JOIN users u ON u.id = m.user_id
        LEFT JOIN reactions r ON r.message_id = m.id
        WHERE m.id = ?
        GROUP BY m.id
        """,
        (message_id,),
    ).fetchone()
    conn.close()
    return row


def create_message(topic_id: int, parent_id: Optional[int], user_id: int, body: str) -> sqlite3.Row:
    conn = _connect()
    cur = conn.execute(
        "INSERT INTO messages (topic_id, parent_id, user_id, body, created_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (topic_id, parent_id, user_id, body, _now()),
    )
    conn.commit()
    message_id = cur.lastrowid
    conn.close()
    row = get_message(int(message_id))
    if not row:
        raise RuntimeError("Message insert failed")
    return row


def set_reaction(message_id: int, user_id: int, value: int) -> sqlite3.Row:
    conn = _connect()
    conn.execute(
        """
        INSERT INTO reactions (message_id, user_id, value, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(message_id, user_id)
        DO UPDATE SET value = excluded.value, created_at = excluded.created_at
        """,
        (message_id, user_id, value, _now()),
    )
    conn.commit()
    conn.close()
    row = get_message(message_id)
    if not row:
        raise RuntimeError("Reaction update failed")
    return row


def update_message(message_id: int, user_id: int, body: str) -> Optional[sqlite3.Row]:
    conn = _connect()
    cur = conn.execute(
        "UPDATE messages SET body = ? WHERE id = ? AND user_id = ?",
        (body, message_id, user_id),
    )
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        return None
    row = get_message(message_id)
    return row
