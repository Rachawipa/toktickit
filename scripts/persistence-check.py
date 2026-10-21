#!/usr/bin/env python3
"""Persistence check for a deployed TokTickIT (run it before and after a redeploy).

  CHECK_EMAIL=<requester email> CHECK_PASSWORD=<password> python3 scripts/persistence-check.py create https://<service-url>
  ... redeploy (Actions > Deploy > Run workflow) ...
  python3 scripts/persistence-check.py verify

create: logs in as a Requester, creates a ticket, attaches a small file, and saves the login
        token, ids and the file's SHA-256 in .persistence-state.json (never commit that file).
verify: with the SAVED token (no new login) checks that
        1. the old login session is still accepted        (sessions live in PostgreSQL)
        2. the ticket is still there                      (data lives in PostgreSQL)
        3. the attachment downloads with identical bytes  (files live in PostgreSQL, not on disk)
Exit code 0 = all passed. Only needs Python 3 (standard library).
"""
import hashlib, json, os, sys, time, urllib.error, urllib.request, uuid

STATE = ".persistence-state.json"


def call(method, url, token=None, body=None, headers=None):
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def jcall(method, url, token=None, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    status, raw = call(method, url, token, data, {"Content-Type": "application/json"} if data else {})
    try:
        return status, json.loads(raw or b"null")
    except ValueError:
        return status, None


def create(base):
    email, password = os.environ.get("CHECK_EMAIL"), os.environ.get("CHECK_PASSWORD")
    if not email or not password:
        sys.exit("Set CHECK_EMAIL and CHECK_PASSWORD (a Requester account).")
    s, body = jcall("POST", f"{base}/api/auth/login", payload={"email": email, "password": password})
    if s != 200:
        sys.exit(f"FAIL login: HTTP {s} {body}")
    token = body["token"]
    if body["user"].get("mustChangePassword"):
        sys.exit("This account must change its password first: log in once in the browser, then retry.")
    s, cats = jcall("GET", f"{base}/api/categories", token)
    s2, systems = jcall("GET", f"{base}/api/systems", token)
    if s != 200 or s2 != 200 or not cats or not systems:
        sys.exit("FAIL: categories/systems are empty. Did the bootstrap run on this deployment?")
    summary = f"persistence check {time.strftime('%Y-%m-%d %H:%M:%S')}"
    s, ticket = jcall("POST", f"{base}/api/tickets", token, {
        "categoryId": cats[0]["id"], "relatedSystem": systems[0]["name"],
        "requestedPriority": "LOW", "summary": summary, "description": "created by scripts/persistence-check.py"})
    if s != 201:
        sys.exit(f"FAIL create ticket: HTTP {s} {ticket}")
    content = f"%PDF-1.4 persistence check {uuid.uuid4()}".encode()
    sha = hashlib.sha256(content).hexdigest()
    boundary = uuid.uuid4().hex
    body_bytes = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"check.pdf\"\r\n"
                  f"Content-Type: application/pdf\r\n\r\n").encode() + content + f"\r\n--{boundary}--\r\n".encode()
    s, raw = call("POST", f"{base}/api/tickets/{ticket['id']}/attachments", token, body_bytes,
                  {"Content-Type": f"multipart/form-data; boundary={boundary}"})
    if s != 201:
        sys.exit(f"FAIL upload attachment: HTTP {s} {raw[:200]}")
    att = json.loads(raw)
    json.dump({"base": base, "token": token, "ticketId": ticket["id"], "attachmentId": att["id"],
               "sha256": sha, "summary": summary}, open(STATE, "w"))
    print(f"OK created ticket #{ticket['id']} with attachment #{att['id']} (sha256 {sha[:12]}...)")
    print("Now redeploy, then run:  python3 scripts/persistence-check.py verify")


def verify():
    st = json.load(open(STATE))
    base, token = st["base"], st["token"]
    results = []

    s, _ = jcall("GET", f"{base}/api/auth/me", token)
    results.append(("old login session still valid", s == 200, f"HTTP {s}"))

    s, t = jcall("GET", f"{base}/api/tickets/{st['ticketId']}", token)
    ticket = (t or {}).get("ticket", t) if s == 200 else None
    results.append(("ticket still exists", bool(ticket) and ticket.get("summary") == st["summary"], f"HTTP {s}"))

    s, raw = call("GET", f"{base}/api/attachments/{st['attachmentId']}", token)
    same = s == 200 and hashlib.sha256(raw).hexdigest() == st["sha256"]
    results.append(("attachment downloads with identical bytes", same, f"HTTP {s}"))

    for name, ok, info in results:
        print(("PASS  " if ok else "FAIL  ") + name + f"  ({info})")
    sys.exit(0 if all(ok for _, ok, _ in results) else 1)


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "create":
        create(sys.argv[2].rstrip("/"))
    elif len(sys.argv) == 2 and sys.argv[1] == "verify":
        verify()
    else:
        sys.exit(__doc__)
