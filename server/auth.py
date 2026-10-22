"""Invite-only accounts. The first account needs no invite and becomes the admin."""
import hashlib
import hmac
import os
import secrets
import time

from fastapi import HTTPException, Request, Response

from db import conn
from i18n import tr

COOKIE = "yk_session"
COOKIE_AGE = 60 * 60 * 24 * 365
# behind Cloudflare the site is https; local dev is plain http, where a Secure cookie would be dropped
COOKIE_SECURE = os.environ.get("YOINKER_COOKIE_SECURE", "0") == "1"


def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${h.hex()}"


def check_password(pw: str, stored: str) -> bool:
    _, salt, h = stored.split("$")
    got = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1)
    return hmac.compare_digest(got.hex(), h)


def public(u) -> dict:
    return {"id": u["id"], "name": u["name"], "is_admin": bool(u["is_admin"])}


def start_session(resp: Response, user_id: int):
    token = secrets.token_urlsafe(32)
    conn().execute("insert into sessions (token, user_id, created) values (?, ?, ?)", (token, user_id, time.time()))
    resp.set_cookie(COOKIE, token, max_age=COOKIE_AGE, httponly=True, samesite="lax", secure=COOKIE_SECURE)


def end_session(req: Request, resp: Response):
    conn().execute("delete from sessions where token = ?", (req.cookies.get(COOKIE, ""),))
    resp.delete_cookie(COOKIE)


def current_user(req: Request) -> dict:
    """The browser's session cookie, or a device's token (Authorization: Bearer ...) for the iPod extension."""
    row = conn().execute("select u.* from sessions s join users u on u.id = s.user_id where s.token = ?",
                         (req.cookies.get(COOKIE, ""),)).fetchone()
    if not row and (bearer := req.headers.get("authorization", "")).lower().startswith("bearer "):
        token = bearer[7:].strip()
        row = conn().execute("select u.* from devices d join users u on u.id = d.user_id where d.token = ?", (token,)).fetchone()
        if row:
            conn().execute("update devices set last_seen = ? where token = ?", (time.time(), token))
    if not row:
        raise HTTPException(401, tr("Please log in", "请先登录"))
    return public(row)


def add_device(user: dict, name: str) -> dict:
    token = secrets.token_urlsafe(32)
    did = conn().execute("insert into devices (user_id, name, token, created) values (?, ?, ?, ?)",
                         (user["id"], name.strip()[:40] or "iPod", token, time.time())).lastrowid
    return {"id": did, "name": name, "token": token}


def devices(user: dict) -> list[dict]:
    return [{"id": r["id"], "name": r["name"], "created": r["created"], "last_seen": r["last_seen"]}
            for r in conn().execute("select * from devices where user_id = ? order by created", (user["id"],))]


def remove_device(user: dict, did: int):
    conn().execute("delete from devices where id = ? and user_id = ?", (did, user["id"]))


def register(name: str, pw: str, invite: str | None) -> dict:
    name = name.strip()
    if not 1 <= len(name) <= 32:
        raise HTTPException(400, tr("Names are 1–32 characters", "名字要 1–32 个字"))
    if len(pw) < 6:
        raise HTTPException(400, tr("Passwords need at least 6 characters", "密码至少 6 位"))
    c = conn()
    c.execute("begin immediate")
    try:
        first = c.execute("select count(*) from users").fetchone()[0] == 0
        inv = None
        if not first:
            inv = c.execute("select * from invites where code = ? and used_by is null", ((invite or "").strip(),)).fetchone()
            if not inv:
                raise HTTPException(403, tr("That invite code is wrong or already used", "邀请码无效或已被用过"))
        if c.execute("select 1 from users where name = ?", (name,)).fetchone():
            raise HTTPException(409, tr("That name is taken", "这个名字已经有人用了"))
        uid = c.execute("insert into users (name, pw_hash, is_admin, invited_by, created) values (?, ?, ?, ?, ?)",
                        (name, hash_password(pw), int(first), inv["created_by"] if inv else None, time.time())).lastrowid
        if inv:
            c.execute("update invites set used_by = ? where code = ?", (uid, inv["code"]))
        c.execute("commit")
    except BaseException:
        c.execute("rollback")
        raise
    return public(c.execute("select * from users where id = ?", (uid,)).fetchone())


def login(name: str, pw: str) -> dict:
    row = conn().execute("select * from users where name = ?", (name.strip(),)).fetchone()
    if not row or not check_password(pw, row["pw_hash"]):
        raise HTTPException(401, tr("Wrong name or password", "名字或密码不对"))
    return public(row)


def create_invite(user_id: int) -> str:
    code = secrets.token_urlsafe(6)
    conn().execute("insert into invites (code, created_by, created) values (?, ?, ?)", (code, user_id, time.time()))
    return code
