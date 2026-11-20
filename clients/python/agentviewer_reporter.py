"""Agentviewer reporter: let your own system (e.g. a data
pipeline or a batch job) show up in the Agentviewer office and tell it what it is doing.

Copy this single file into your project. Standard library only. It never raises
and never blocks your code: reports go out on a background thread, and if
Agentviewer is not running they are silently dropped.

    from agentviewer_reporter import Reporter

    av = Reporter("MyApp", client="내 파이프라인")
    av.update("web", task="피드 감시", detail="피드 확인 중")

    with av.step("typing", "요약 생성: 샘플 항목"):
        caption = make_caption(item)          # your code

    av.update("running", detail="결과 전송: 대상 서버")
    av.done("전송 완료")

States: thinking, typing, reading, running, web, mcp, delegating, planning,
waiting, done, idle.  Server address: AGENTVIEWER_URL (default
http://127.0.0.1:4747), token: AGENTVIEWER_TOKEN.
"""

import atexit
import contextlib
import json
import os
import queue
import threading
import time
import urllib.request

STATES = {
    "thinking", "typing", "reading", "running", "web", "mcp",
    "delegating", "planning", "waiting", "done", "idle",
}


class _Sender:
    """One background thread per process keeps reports in order."""

    _instance = None
    _lock = threading.Lock()

    def __init__(self):
        self.q = queue.Queue(maxsize=200)
        t = threading.Thread(target=self._run, name="agentviewer-reporter", daemon=True)
        t.start()

    @classmethod
    def get(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = _Sender()
            return cls._instance

    def put(self, url, headers, body):
        try:
            self.q.put_nowait((url, headers, body))
        except queue.Full:
            pass  # never slow the host system down

    def flush(self, timeout=2.0):
        end = time.monotonic() + timeout
        while self.q.unfinished_tasks and time.monotonic() < end:
            time.sleep(0.02)

    def _run(self):
        while True:
            url, headers, body = self.q.get()
            try:
                req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST")
                urllib.request.urlopen(req, timeout=1.5).read()
            except Exception:
                pass
            finally:
                self.q.task_done()


class Reporter:
    def __init__(self, name, *, client=None, channel=None, id=None, door="api",
                 parent=None, url=None, token=None, ttl_seconds=600, project=None):
        self.server = (url or os.environ.get("AGENTVIEWER_URL") or "http://127.0.0.1:4747").rstrip("/")
        self.url = self.server + "/api/report"
        token = token or os.environ.get("AGENTVIEWER_TOKEN")
        self.token = token
        self.headers = {"content-type": "application/json"}
        if token:
            self.headers["authorization"] = "Bearer " + token
        self.id = id or name
        self.base = {
            "id": self.id,
            "name": name,
            "client": client or name,
            "channel": channel or client or name,
            "door": door,
            "ttl_seconds": ttl_seconds,
        }
        if parent:
            self.base["parent"] = parent
        if project:
            self.base["project"] = project
        self.task = None

    def update(self, state, detail=None, *, task=None, path=None, tool=None, mcp_server=None):
        """Report what is happening right now."""
        if state not in STATES:
            state = "running"
        if task is not None:
            self.task = task
        body = dict(self.base, state=state)
        if self.task:
            body["task"] = self.task
        if detail is not None:
            body["detail"] = str(detail)[:300]
        if path:
            body["path"] = path
        if tool:
            body["tool"] = tool
        if mcp_server:
            body["mcp_server"] = mcp_server
        _Sender.get().put(self.url, self.headers, body)
        return self

    @contextlib.contextmanager
    def step(self, state, detail=None, **kw):
        """`with av.step("typing", "요약 생성"): ...` — reports failures too."""
        self.update(state, detail, **kw)
        try:
            yield self
        except BaseException as exc:
            self.update("waiting", f"오류: {type(exc).__name__}: {exc}"[:300])
            raise

    def done(self, detail="완료"):
        return self.update("done", detail)

    def idle(self, detail="대기 중"):
        return self.update("idle", detail)

    def child(self, name, **kw):
        """A sub-worker drawn next to this one (e.g. one per news item)."""
        kw.setdefault("client", self.base["client"])
        kw.setdefault("channel", self.base["channel"])
        kw.setdefault("door", self.base["door"])
        kw.setdefault("url", self.server)
        kw.setdefault("token", self.token)
        return Reporter(name, parent=self.id, id=kw.pop("id", f"{self.id}-{name}"), **kw)

    def close(self, detail="종료"):
        """Leave the office (call on shutdown)."""
        body = dict(self.base, state="done", detail=detail, finished=True)
        _Sender.get().put(self.url, self.headers, body)
        _Sender.get().flush()


def _flush_at_exit():
    if _Sender._instance is not None:
        _Sender._instance.flush()


atexit.register(_flush_at_exit)
