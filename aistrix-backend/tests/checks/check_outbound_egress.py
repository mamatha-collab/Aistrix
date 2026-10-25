"""Outbound requests on a fake network: connections go to the address that
was checked (no DNS rebinding), allow/block lists hold on every hop, and
redirects never carry credentials or bodies to another site. No real requests."""
import asyncio
import socket
from unittest.mock import patch

import _harness
from _harness import ok, finish
_harness.setup()
import httpx
import main
import outbound
import flow_plan

DNS = {}            # host -> list of answers, consumed in order per lookup
LOOKUPS = []
SEEN = []           # every request the fake network received
ROUTES = {}         # (host header, path) -> handler(request) -> Response


def answer(address):
    family = socket.AF_INET6 if ":" in address else socket.AF_INET
    return (family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (address, 443))


def resolve(host, *args, **kwargs):
    LOOKUPS.append(host)
    answers = DNS[host]
    current = answers.pop(0) if len(answers) > 1 else answers[0]
    return [answer(a) for a in current]


def network(request: httpx.Request) -> httpx.Response:
    SEEN.append(request)
    handler = ROUTES.get((request.headers.get("host"), request.url.path))
    return handler(request) if handler else httpx.Response(200, text="ok")


outbound.transport = httpx.MockTransport(network)


def fetch(*args, **kwargs):
    SEEN.clear(); LOOKUPS.clear()
    with patch.object(socket, "getaddrinfo", side_effect=resolve):
        try:
            return asyncio.run(outbound.fetch_safely(*args, **kwargs))
        except ValueError as e:
            return e


# ── the connection uses the address that was checked ────────────────────────
DNS["rebind.example"] = [["93.184.216.34"], ["169.254.169.254"]]   # public first, internal on any later lookup
r = fetch("GET", "https://rebind.example/data?x=1")
req = SEEN[0]
ok("the request connects to the checked public address", r.status_code == 200 and req.url.host == "93.184.216.34")
ok("…with the real host name for the server and for TLS", req.headers["host"] == "rebind.example"
   and req.extensions.get("sni_hostname") == "rebind.example")
ok("…after a single lookup, so a second DNS answer can't redirect it", LOOKUPS == ["rebind.example"])
ok("the query string is kept", req.url.query == b"x=1")
DNS["v6.example"] = [["2606:4700:4700::1111"]]
r = fetch("GET", "http://v6.example:8080/x")
ok("IPv6 addresses and ports are pinned correctly", SEEN[0].url.host == "2606:4700:4700::1111" and SEEN[0].url.port == 8080
   and SEEN[0].headers["host"] == "v6.example:8080" and "sni_hostname" not in SEEN[0].extensions)
DNS["creds.example"] = [["93.184.216.34"]]
fetch("GET", "https://user:secret@creds.example/x")
ok("user info in the URL is never sent", b"secret" not in bytes(str(SEEN[0].url), "utf-8") and "authorization" not in SEEN[0].headers)
DNS["mapped.example"] = [["::ffff:127.0.0.1"]]
ok("IPv4-mapped loopback is refused", isinstance(fetch("GET", "https://mapped.example/"), ValueError) and not SEEN)

# ── redirects ────────────────────────────────────────────────────────────────
DNS.update({"api.example": [["93.184.216.34"]], "other.example": [["93.184.216.35"]], "internal.example": [["10.0.0.5"]]})
ROUTES[("api.example", "/hop")] = lambda r: httpx.Response(302, headers={"location": "https://other.example/land"})
r = fetch("GET", "https://api.example/hop", headers={"Authorization": "Bearer t0k", "X-Api-Key": "k3y", "Cookie": "s=1",
                                                      "User-Agent": "Aistrix/1.0"})
landed = SEEN[-1]
ok("a redirect to another site drops credentials and custom headers",
   r.status_code == 200 and landed.headers["host"] == "other.example" and "authorization" not in landed.headers
   and "x-api-key" not in landed.headers and "cookie" not in landed.headers and landed.headers["user-agent"] == "Aistrix/1.0")
ROUTES[("api.example", "/same")] = lambda r: httpx.Response(301, headers={"location": "/moved"})
fetch("GET", "https://api.example/same", headers={"Authorization": "Bearer t0k"})
ok("a redirect within the same site keeps them", SEEN[-1].url.path == "/moved" and SEEN[-1].headers["authorization"] == "Bearer t0k")
ROUTES[("api.example", "/keep")] = lambda r: httpx.Response(307, headers={"location": "https://other.example/land"})
r = fetch("POST", "https://api.example/keep", json={"card": "secret"})
ok("a redirect that would re-send the body to another site is refused before contacting it",
   isinstance(r, ValueError) and "body" in str(r) and [s.headers["host"] for s in SEEN] == ["api.example"])
ROUTES[("api.example", "/see")] = lambda r: httpx.Response(303, headers={"location": "/result"})
fetch("POST", "https://api.example/see", content=b"payload", headers={"Content-Type": "text/plain"})
ok("303 continues as GET without the body", SEEN[-1].method == "GET" and SEEN[-1].content == b"" and "content-type" not in SEEN[-1].headers)
ROUTES[("api.example", "/old")] = lambda r: httpx.Response(302, headers={"location": "https://other.example/new"})
r = fetch("POST", "https://api.example/old", json={"a": 1}, headers={"Authorization": "Bearer t0k"})
ok("302 after POST continues as GET, so no body crosses sites", r.status_code == 200 and SEEN[-1].method == "GET"
   and SEEN[-1].content == b"" and "authorization" not in SEEN[-1].headers)
ROUTES[("api.example", "/down")] = lambda r: httpx.Response(302, headers={"location": "http://api.example/plain"})
ok("https → http redirects are refused", isinstance(fetch("GET", "https://api.example/down"), ValueError) and len(SEEN) == 1)
ROUTES[("api.example", "/inside")] = lambda r: httpx.Response(302, headers={"location": "https://internal.example/admin"})
ok("a redirect to an internal address is refused before contacting it",
   isinstance(fetch("GET", "https://api.example/inside"), ValueError) and len(SEEN) == 1)
ROUTES[("api.example", "/loop")] = lambda r: httpx.Response(302, headers={"location": "/loop"})
ok("redirect loops stop", isinstance(fetch("GET", "https://api.example/loop", max_redirects=3), ValueError) and len(SEEN) == 4)
r = fetch("GET", "https://api.example/hop", max_redirects=0)
ok("with redirects off, the first answer comes back as is", r.status_code == 302 and len(SEEN) == 1)

# ── allow and block lists ────────────────────────────────────────────────────
ok("host patterns: exact names and *.subdomains (not the bare domain)",
   outbound.host_matches("a.trusted.io", ["*.trusted.io"]) and not outbound.host_matches("trusted.io", ["*.trusted.io"])
   and outbound.host_matches("API.Example.", ["api.example"]) and not outbound.host_matches("evilapi.example", ["api.example"]))
r = fetch("GET", "https://other.example/x", allowed_hosts=["api.example"])
ok("a tool's allowlist refuses other hosts before any request", isinstance(r, ValueError) and "tool's list" in str(r) and not SEEN and not LOOKUPS)
r = fetch("GET", "https://api.example/hop", allowed_hosts=["api.example"])
ok("…and holds on redirect hops", isinstance(r, ValueError) and [s.headers["host"] for s in SEEN] == ["api.example"])
outbound.ALLOWED_HOSTS = ("api.example",)
ok("the operator's allowlist refuses everything else",
   isinstance(fetch("GET", "https://other.example/x"), ValueError) and fetch("GET", "https://api.example/x").status_code == 200)
outbound.ALLOWED_HOSTS = ()
outbound.BLOCKED_HOSTS = ("*.example",)
ok("the operator's blocklist refuses matching hosts", isinstance(fetch("GET", "https://api.example/x"), ValueError) and not SEEN)
outbound.BLOCKED_HOSTS = ()
ok("cloud metadata names are always refused", isinstance(fetch("GET", "http://metadata.google.internal/x"), ValueError))

# ── where the app and workflow paths use it ──────────────────────────────────
DNS["crm.example"] = [["93.184.216.36"]]
tool = {"type": "http", "config": {"method": "POST", "allowed_hosts": ["crm.example"]}}
with patch.object(socket, "getaddrinfo", side_effect=resolve):
    SEEN.clear()
    out = asyncio.run(main.execute_tool(tool, {"url": "https://other.example/steal", "note": "data"}))
ok("an HTTP tool with an allowlist can't be pointed elsewhere by the model", out.startswith("Invalid URL") and not SEEN)
with patch.object(socket, "getaddrinfo", side_effect=resolve):
    SEEN.clear()
    out = asyncio.run(main.execute_tool(tool, {"url": "https://crm.example/notes", "note": "data"}))
ok("…but reaches its listed host", out.startswith("HTTP 200") and SEEN[0].headers["host"] == "crm.example")
ok("API step addresses: server fixed, path may be filled",
   flow_plan.api_url_origin("https://crm.example/{{previous_output}}") == ("https", "crm.example", None)
   and flow_plan.api_url_origin("https://{{previous_output}}/x") is None
   and flow_plan.api_url_origin("https://crm.example{{previous_output}}") is None
   and flow_plan.api_url_origin("ftp://crm.example/x") is None)
with patch.object(socket, "getaddrinfo", side_effect=resolve):
    SEEN.clear()
    step = {"step_type": "api_call", "api_method": "GET", "api_url": "https://crm.example/lookup/{{previous_output}}"}
    out = asyncio.run(main._run_api_step(step, "@other.example/x"))
ok("earlier output in the path can't change the server", out["status"] == "ok" and SEEN and SEEN[0].headers["host"] == "crm.example")
out = asyncio.run(main._run_api_step({"step_type": "api_call", "api_url": "https://{{previous_output}}/x"}, "other.example"))
ok("an address whose server comes from earlier output is refused at run time", out["status"] == "failed" and "server" in out["error"])
problems = flow_plan.compile_flow({"steps": [{"id": "s1", "step_type": "api_call", "api_url": "https://{{previous_output}}/x"}]}, {})[1]
ok("…and before the run starts", any("server part" in p["text"] for p in problems))
finish()
