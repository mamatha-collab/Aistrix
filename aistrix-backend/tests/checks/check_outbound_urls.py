"""Outbound DNS and redirect regression checks; no network requests."""
import asyncio
import socket
from unittest.mock import patch

import _harness
from _harness import ok, finish

_harness.setup()
import main


def answer(address):
    family = socket.AF_INET6 if ":" in address else socket.AF_INET
    return (family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (address, 443))


def accepted(addresses):
    with patch.object(main.socket, "getaddrinfo", return_value=[answer(a) for a in addresses]):
        try:
            main.assert_public_url("https://tool.example/run")
            return True
        except ValueError:
            return False


ok("public IPv4 and IPv6 answers accepted", accepted(["8.8.8.8", "2606:4700:4700::1111"]))
ok("empty DNS answers rejected", not accepted([]))
for private in ("127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fc00::1", "::ffff:127.0.0.1"):
    ok(f"mixed public/private DNS rejected: {private}", not accepted(["8.8.8.8", private]))
    ok(f"private-first DNS rejected: {private}", not accepted([private, "8.8.8.8"]))

with patch.object(main.socket, "getaddrinfo", side_effect=socket.gaierror):
    try:
        main.assert_public_url("https://tool.example/run")
        ok("DNS failure rejected", False)
    except ValueError:
        ok("DNS failure rejected", True)


async def check_redirect():
    requests = []

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def request(self, method, url, **kwargs):
            requests.append(url)
            return main.httpx.Response(302, headers={"location": "https://mixed.example/internal"})

    def resolve(hostname, *args):
        addresses = ["8.8.8.8"] if hostname == "tool.example" else ["8.8.8.8", "10.0.0.1"]
        return [answer(a) for a in addresses]

    with patch.object(main.socket, "getaddrinfo", side_effect=resolve), patch.object(main.httpx, "AsyncClient", return_value=Client()):
        try:
            await main.fetch_safely("GET", "https://tool.example/run")
            ok("mixed DNS redirect rejected", False)
        except ValueError:
            ok("mixed DNS redirect rejected before destination request", requests == ["https://tool.example/run"])


asyncio.run(check_redirect())
finish()
