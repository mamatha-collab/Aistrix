"""Outbound HTTP to addresses that developers, app tools, models or workflows
choose. Every hop:

- resolves the host once, requires every answer to be a public address, and
  connects to that checked address (TLS still verifies the real hostname), so a
  second DNS answer can't point the connection somewhere internal;
- applies the operator's allow/block lists (OUTBOUND_ALLOWED_HOSTS,
  OUTBOUND_BLOCKED_HOSTS) and the caller's own allowlist, if it has one;
- on a redirect to another site, drops credentials and custom headers, refuses
  to carry a request body there, and refuses https → http.
"""
import ipaddress
import os
import socket
from typing import Optional, Sequence
from urllib.parse import urlsplit

import httpx

BLOCKED_HOSTNAMES = {"metadata.google.internal"}
REDIRECT_STATUSES = (301, 302, 303, 307, 308)
# The only caller headers that follow a redirect to another site.
CROSS_SITE_HEADERS = {"user-agent", "accept", "accept-language"}
_BODY_ARGS = ("content", "json", "data", "files")


def _host_list(raw: Optional[str]) -> tuple[str, ...]:
    return tuple(h.strip().lower().rstrip(".") for h in (raw or "").split(",") if h.strip())


ALLOWED_HOSTS = _host_list(os.getenv("OUTBOUND_ALLOWED_HOSTS"))
BLOCKED_HOSTS = _host_list(os.getenv("OUTBOUND_BLOCKED_HOSTS"))
# Tests replace this with httpx.MockTransport; nothing else sets it.
transport: Optional[httpx.AsyncBaseTransport] = None


def host_matches(host: str, patterns: Sequence[str]) -> bool:
    """Exact host names, or "*.example.com" for any subdomain of example.com."""
    host = host.lower().rstrip(".")
    for pattern in patterns:
        pattern = str(pattern).strip().lower().rstrip(".")
        if pattern.startswith("*.") and host.endswith(pattern[1:]) and host != pattern[2:]:
            return True
        if host == pattern:
            return True
    return False


def is_public_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return not (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_multicast or ip.is_reserved or ip.is_unspecified)


def check_host_allowed(host: str, allowed_hosts: Optional[Sequence[str]] = None) -> None:
    host = host.lower().rstrip(".")
    if host in BLOCKED_HOSTNAMES or host_matches(host, BLOCKED_HOSTS):
        raise ValueError("This host is not allowed")
    if ALLOWED_HOSTS and not host_matches(host, ALLOWED_HOSTS):
        raise ValueError("This host isn't on this server's list of allowed destinations")
    if allowed_hosts is not None and not host_matches(host, allowed_hosts):
        raise ValueError("This host isn't on this tool's list of allowed destinations")


def resolve_public(url: str, allowed_hosts: Optional[Sequence[str]] = None) -> list[str]:
    """The checked addresses for url's host. Raises ValueError otherwise."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise ValueError("URL must use http:// or https://")
    hostname = parts.hostname
    if not hostname:
        raise ValueError("URL has no hostname")
    check_host_allowed(hostname, allowed_hosts)
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        raise ValueError("Could not resolve host")
    addresses = list(dict.fromkeys(info[4][0] for info in infos))
    # A client may pick any answer: one public answer can't vouch for another.
    if not addresses or not all(is_public_ip(a) for a in addresses):
        raise ValueError("URL resolves to a non-public address, which is not allowed")
    return addresses


def assert_public_url(url: str, allowed_hosts: Optional[Sequence[str]] = None) -> None:
    resolve_public(url, allowed_hosts)


def _origin(url: str) -> tuple:
    parts = urlsplit(url)
    return parts.scheme, (parts.hostname or "").lower(), parts.port or (443 if parts.scheme == "https" else 80)


def pinned_request(url: str, address: str) -> tuple[str, str]:
    """(url with the checked address in place of the host, Host header).
    User info in the URL is dropped: credentials go in headers, if anywhere."""
    parts = urlsplit(url)
    ip_host = f"[{address}]" if ":" in address else address
    port = f":{parts.port}" if parts.port else ""
    return parts._replace(netloc=ip_host + port).geturl(), (parts.hostname or "") + port


async def fetch_safely(method: str, url: str, *, timeout: float = 15, max_redirects: int = 5,
                       allowed_hosts: Optional[Sequence[str]] = None, **kwargs) -> httpx.Response:
    """One request (and its redirects) under the rules above. ValueError means
    the destination was refused; nothing was sent to it."""
    headers = {str(k): str(v) for k, v in (kwargs.pop("headers", None) or {}).items()}
    params = kwargs.pop("params", None)
    body = {k: kwargs.pop(k) for k in _BODY_ARGS if k in kwargs}
    if kwargs:
        raise TypeError(f"fetch_safely got unexpected arguments: {', '.join(kwargs)}")
    method = method.upper()
    start = _origin(url)
    current = url
    async with httpx.AsyncClient(follow_redirects=False, timeout=timeout, trust_env=False, transport=transport) as client:
        for hop in range(max_redirects + 1):
            address = resolve_public(current, allowed_hosts)[0]
            target, host = pinned_request(current, address)
            hostname = urlsplit(current).hostname or ""
            extensions = {"sni_hostname": hostname} if current.startswith("https://") else {}
            headers = {k: v for k, v in headers.items() if k.lower() != "host"}
            resp = await client.request(method, target, headers={**headers, "Host": host},
                                        params=params if hop == 0 else None, extensions=extensions, **body)
            location = resp.headers.get("location")
            # max_redirects=0: the caller wants the first answer, redirect or not.
            if resp.status_code not in REDIRECT_STATUSES or not location or max_redirects == 0:
                return resp
            following = str(httpx.URL(current).join(location))
            if current.startswith("https://") and following.startswith("http://"):
                raise ValueError("Refused a redirect from https to http")
            if resp.status_code == 303 or (resp.status_code in (301, 302) and method == "POST"):
                method = "GET" if method != "HEAD" else "HEAD"
                body = {}
                headers = {k: v for k, v in headers.items() if k.lower() not in ("content-type", "content-length")}
            if _origin(following) != start:
                if body:
                    raise ValueError("Refused a redirect that would send the request body to another site")
                # Credentials and custom headers were meant for the first site only.
                headers = {k: v for k, v in headers.items() if k.lower() in CROSS_SITE_HEADERS}
            current = following
    raise ValueError("Too many redirects")
