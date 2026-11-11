"""Importing working code from GitHub into a code app. GitHub is faked: the
archive is built in memory in the layout GitHub returns (owner-repo-sha/...)."""
import io
import json
import sys
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import code_import
from code_job_spec import MAX_FILE, SPEC, STARTER
from test_code_jobs import APP, Host, call

HEADERS = {"Authorization": "Bearer fixture"}
ROOT = "acme-pricing-1a2b3c4"


def repo_zip(files: dict, root: str = ROOT) -> bytes:
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as archive:
        archive.writestr(root + "/", "")
        for name, content in files.items():
            archive.writestr(f"{root}/{name}", content)
    return data.getvalue()


WORKING = {
    "README.md": "# Pricing job",
    "jobs/pricing/main.py": "from rules import total\n\ndef run(payload):\n    return {'total': total(payload['items'])}\n",
    "jobs/pricing/rules.py": "def total(items):\n    return sum(i['price'] for i in items)\n",
    "jobs/pricing/aistrix.json": json.dumps({"entrypoint": "main:run", "timeout_seconds": 20}),
    "jobs/pricing/requirements.txt": "",
    "jobs/pricing/logo.png": "\x89PNG",
    "jobs/pricing/__pycache__/rules.cpython-312.pyc": "x",
    "jobs/pricing/.env": "SECRET=1",
    "jobs/other/main.py": "def run(p): return p\n",
    "main.py": STARTER,
}


# ── Parsing links ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("text,expect", [
    ("acme/pricing", ("acme", "pricing", None, "")),
    ("https://github.com/acme/pricing", ("acme", "pricing", None, "")),
    ("https://github.com/acme/pricing.git", ("acme", "pricing", None, "")),
    ("github.com/acme/pricing/tree/main/jobs/pricing", ("acme", "pricing", "main", "jobs/pricing")),
    ("https://www.github.com/acme/pricing/tree/v1.2", ("acme", "pricing", "v1.2", "")),
])
def test_repository_links_are_understood(text, expect):
    src = code_import.parse_source(text)
    assert (src.owner, src.repo, src.ref, src.path) == expect


@pytest.mark.parametrize("text,ref,path", [
    ("pricing", None, None), ("https://gitlab.com/acme/pricing", None, None), ("acme/pricing/blob/main/x.py", None, None),
    ("acme/pricing", "../../etc", None), ("acme/pricing", None, "../secrets"), ("acme/pri cing", None, None),
])
def test_bad_links_refs_and_paths_are_refused(text, ref, path):
    with pytest.raises(ValueError):
        code_import.parse_source(text, ref, path)


def test_the_archive_url_names_the_ref():
    assert code_import.archive_url(code_import.Source("acme", "pricing")) == "https://api.github.com/repos/acme/pricing/zipball"
    assert code_import.archive_url(code_import.Source("acme", "pricing", "feature/x")).endswith("/zipball/feature%2Fx")


# ── Choosing files ───────────────────────────────────────────────────────────

def test_a_folder_imports_its_source_and_manifest_and_lists_what_was_skipped():
    sel = code_import.select(repo_zip(WORKING), "jobs/pricing")
    assert sorted(sel.files) == ["main.py", "requirements.txt", "rules.py"]
    assert sel.manifest == {"entrypoint": "main:run", "timeout_seconds": 20}
    assert [s["path"] for s in sel.skipped] == ["logo.png"]        # tooling and hidden files aren't listed
    assert code_import.commit_of(sel.root) == "1a2b3c4"
    files, manifest, digest = code_import.bundle(sel)
    assert manifest["timeout_seconds"] == 20 and len(digest) == 64


def test_the_whole_repository_imports_when_it_fits():
    sel = code_import.select(repo_zip({"main.py": STARTER, "util/helpers.py": "x = 1\n"}))
    assert sorted(sel.files) == ["main.py", "util/helpers.py"] and sel.manifest == {}
    assert code_import.bundle(sel)[1] == SPEC


def test_oversized_files_and_missing_folders_are_explained():
    sel = code_import.select(repo_zip({"main.py": STARTER, "big.py": "x" * (MAX_FILE + 1)}))
    assert {"path": "big.py", "reason": "larger than 128 KiB"} in sel.skipped
    with pytest.raises(ValueError, match="isn't in the repository"):
        code_import.select(repo_zip(WORKING), "jobs/missing")
    with pytest.raises(ValueError, match="No importable source"):
        code_import.select(repo_zip({"image.png": "x"}))


def test_repositories_over_the_runtime_limit_ask_for_a_folder():
    many = {f"pkg/m{i}.py": "x = 1\n" for i in range(40)}
    with pytest.raises(ValueError, match="Import the folder"):
        code_import.select(repo_zip(many))


def test_a_missing_entrypoint_says_how_to_fix_it():
    sel = code_import.select(repo_zip({"app.py": "def handler(p): return p\n"}))
    with pytest.raises(ValueError, match="Add aistrix.json"):
        code_import.bundle(sel)


def test_unpinned_dependencies_are_refused_by_the_contract():
    sel = code_import.select(repo_zip({"main.py": STARTER, "requirements.txt": "requests\n"}))
    with pytest.raises(ValueError, match="pinned"):
        code_import.bundle(sel)


# ── The API ──────────────────────────────────────────────────────────────────

class Response:
    def __init__(self, status, content=b""):
        self.status_code, self.content = status, content


def importing_host(answer, *, github_row=None):
    host = Host()
    host.fetched = []

    async def fetch(method, url, **kw):
        host.fetched.append({"url": url, **kw})
        return answer

    async def row(user_id):
        return github_row

    host.outbound = SimpleNamespace(fetch_safely=fetch)
    host._github_row = row
    host._decrypt = lambda value: "gho_" + value
    return host


def test_importing_a_public_repository_saves_a_source_version():
    host = importing_host(Response(200, repo_zip(WORKING)))
    r = call(host, "POST", f"/v1/apps/{APP}/code/import", headers=HEADERS,
             json={"repo": "https://github.com/acme/pricing/tree/main/jobs/pricing"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert sorted(body["source"]["files"]) == ["main.py", "requirements.txt", "rules.py"]
    assert body["import"]["repo"] == "acme/pricing" and body["import"]["ref"] == "main" and body["import"]["commit"] == "1a2b3c4"
    assert body["import"]["skipped"] == [{"path": "logo.png", "reason": "not a source file the code runtime accepts (.py .txt .json .toml .md)"}]
    assert body["import"]["private_access"] is False
    fetched = host.fetched[0]
    assert fetched["url"] == "https://api.github.com/repos/acme/pricing/zipball/main"
    assert fetched["allowed_hosts"] == ("api.github.com", "codeload.github.com") and "Authorization" not in fetched["headers"]
    assert any(q.rpc == "save_code_source" for q in host.calls)
    assert not any(q.rpc in ("enqueue_code_task", "enqueue_e2b_task") for q in host.calls)     # nothing runs on import


def test_a_connected_github_account_reads_private_repositories():
    host = importing_host(Response(200, repo_zip({"main.py": STARTER})), github_row={"token_encrypted": "secret"})
    r = call(host, "POST", f"/v1/apps/{APP}/code/import", headers=HEADERS, json={"repo": "acme/private-job"})
    assert r.status_code == 200 and r.json()["import"]["private_access"] is True
    assert host.fetched[0]["headers"]["Authorization"] == "Bearer gho_secret"
    assert "gho_secret" not in r.text


@pytest.mark.parametrize("status,code,text", [
    (404, 404, "connect GitHub in Settings"), (403, 403, "refused access"), (500, 502, ""),
])
def test_github_failures_are_explained(status, code, text):
    host = importing_host(Response(status))
    r = call(host, "POST", f"/v1/apps/{APP}/code/import", headers=HEADERS, json={"repo": "acme/pricing"})
    assert r.status_code == code and (code == 502 or text in r.text), r.text
    assert not any(q.rpc == "save_code_source" for q in host.calls)


def test_import_needs_the_app_owner_and_a_valid_link():
    host = importing_host(Response(200, repo_zip(WORKING)))
    assert call(host, "POST", f"/v1/apps/{APP}/code/import", json={"repo": "acme/pricing"}).status_code == 401
    assert call(host, "POST", f"/v1/apps/{APP}/code/import", headers=HEADERS, json={"repo": "not a repo"}).status_code == 422
    host.row["created_by"] = "someone-else"
    assert call(host, "POST", f"/v1/apps/{APP}/code/import", headers=HEADERS, json={"repo": "acme/pricing"}).status_code == 403
    assert host.fetched == []
