"""Import working code from GitHub into a code app's source.

The repository archive is downloaded by the API (through the outbound
rules), never executed here. Only source files the code contract accepts are
kept; everything else is listed as skipped with the reason, so the developer
sees exactly what was imported. A subfolder can be imported on its own, and
aistrix.json in that folder sets the manifest (entrypoint, timeout, memory).
"""
import io
import json
import re
import zipfile
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import quote

from code_job_spec import MAX_FILE, MAX_FILES, MAX_SOURCE, validate_bundle

MAX_ARCHIVE = 25 * 1024 * 1024          # the downloaded zip
MAX_ENTRIES = 5000
GITHUB_HOSTS = ("api.github.com", "codeload.github.com")
ACCEPTED = re.compile(r"[A-Za-z0-9_/-]+\.(py|txt|json|toml|md)")
SKIP_DIRS = {".git", ".github", "__pycache__", "node_modules", "venv", ".venv", "env", "dist", "build", ".tox",
             ".mypy_cache", ".pytest_cache", "site-packages"}
_REPO = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
_REF = re.compile(r"^[A-Za-z0-9_./-]{1,200}$")
_PATH = re.compile(r"^[A-Za-z0-9_./-]{0,300}$")


@dataclass
class Source:
    owner: str
    repo: str
    ref: Optional[str] = None
    path: str = ""
    # A /tree/<rest> link can't say where the branch ends (feat/x/folder):
    # each (ref, path) split to try, shortest branch first.
    candidates: list = field(default_factory=list)
    commit: Optional[str] = None           # the exact commit, once resolved


@dataclass
class Selection:
    files: dict
    manifest: dict
    skipped: list = field(default_factory=list)       # [{"path", "reason"}]
    root: str = ""                                     # the archive's top folder (owner-repo-sha)


def parse_source(text: str, ref: Optional[str] = None, path: Optional[str] = None) -> Source:
    """owner/repo, https://github.com/owner/repo(.git), or a /tree/<ref>/<path> link."""
    value = (text or "").strip()
    value = re.sub(r"^(https?://)?(www\.)?github\.com/", "", value).strip("/")
    value = value.removesuffix(".git")
    parts = value.split("/")
    if len(parts) < 2 or not (_REPO.fullmatch(parts[0]) and _REPO.fullmatch(parts[1])):
        raise ValueError("Give a GitHub repository as owner/repo or its https://github.com link")
    owner, repo, rest = parts[0], parts[1], parts[2:]
    candidates = []
    if rest:
        if rest[0] != "tree" or len(rest) < 2:
            raise ValueError("Link to the repository, or to a folder with /tree/<branch>/<folder>")
        tail = rest[1:]
        if ref:
            candidates = [(ref, path if path is not None else "/".join(tail[len(ref.split("/")):]))]
        else:
            candidates = [("/".join(tail[:i]), path if path is not None else "/".join(tail[i:]))
                          for i in range(1, min(len(tail), 6) + 1)]
    else:
        candidates = [(ref, path or "")]
    checked = []
    for cand_ref, cand_path in candidates:
        cand_path = (cand_path or "").strip("/")
        if cand_ref is not None and (not _REF.fullmatch(cand_ref) or ".." in cand_ref):
            raise ValueError("Not a valid branch, tag or commit")
        if not _PATH.fullmatch(cand_path) or ".." in cand_path.split("/"):
            raise ValueError("Not a valid folder path")
        checked.append((cand_ref, cand_path))
    first_ref, first_path = checked[0]
    return Source(owner, repo, first_ref, first_path, candidates=checked)


def archive_url(src: Source) -> str:
    ref = src.commit or src.ref
    ref = f"/{quote(ref, safe='')}" if ref else ""
    return f"https://api.github.com/repos/{src.owner}/{src.repo}/zipball{ref}"


def commit_url(src: Source, ref: Optional[str]) -> str:
    return f"https://api.github.com/repos/{src.owner}/{src.repo}/commits/{quote(ref or 'HEAD', safe='')}"


def select(data: bytes, path: str = "") -> Selection:
    """The accepted source files under path, with the reasons others were skipped."""
    if len(data) > MAX_ARCHIVE:
        raise ValueError(f"The repository archive is larger than {MAX_ARCHIVE // (1024 * 1024)} MiB; import a folder instead")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as e:
        raise ValueError("GitHub didn't return a valid archive") from e
    entries = [e for e in archive.infolist() if not e.is_dir()]
    if len(entries) > MAX_ENTRIES:
        raise ValueError("The repository has too many files; import a folder instead")
    names = [e.filename for e in archive.infolist()]
    root = names[0].split("/", 1)[0] + "/" if names else ""
    prefix = root + (path.strip("/") + "/" if path else "")
    files, skipped, manifest = {}, [], {}
    found_folder = False
    for entry in entries:
        if not entry.filename.startswith(prefix):
            continue
        found_folder = True
        name = entry.filename[len(prefix):]
        parts = name.split("/")
        if any(p in SKIP_DIRS or p.startswith(".") for p in parts[:-1]) or parts[-1].startswith("."):
            continue                                   # tooling and hidden files: not worth listing
        if entry.flag_bits & 1 or (entry.external_attr >> 16) & 0o170000 == 0o120000:
            skipped.append({"path": name, "reason": "links and encrypted files aren't imported"})
            continue
        if name == "aistrix.json":
            try:
                manifest = json.loads(archive.read(entry).decode("utf-8"))
            except (ValueError, UnicodeError):
                raise ValueError("aistrix.json isn't valid JSON")
            continue
        if not ACCEPTED.fullmatch(name):
            skipped.append({"path": name, "reason": "not a source file the code runtime accepts (.py .txt .json .toml .md)"})
            continue
        if entry.file_size > MAX_FILE:
            skipped.append({"path": name, "reason": f"larger than {MAX_FILE // 1024} KiB"})
            continue
        try:
            files[name] = archive.read(entry).decode("utf-8")
        except UnicodeError:
            skipped.append({"path": name, "reason": "not UTF-8 text"})
    if path and not found_folder:
        raise ValueError(f"The folder {path!r} isn't in the repository")
    if not isinstance(manifest, dict):
        raise ValueError("aistrix.json must be an object")
    if not files:
        raise ValueError("No importable source files were found" + (f" in {path!r}" if path else ""))
    if len(files) > MAX_FILES or sum(len(v.encode("utf-8")) for v in files.values()) > MAX_SOURCE:
        raise ValueError(f"The code is larger than the runtime's limit ({MAX_FILES} files, {MAX_SOURCE // 1024} KiB). "
                         "Import the folder that holds the job, or remove unneeded files")
    return Selection(files, manifest, sorted(skipped, key=lambda s: s["path"]), root.rstrip("/"))


def bundle(selection: Selection):
    """The validated (files, manifest, digest), with a hint when the entrypoint is the problem."""
    try:
        return validate_bundle(selection.files, selection.manifest)
    except ValueError as e:
        if "entrypoint" in str(e).lower():
            raise ValueError(f"{e} Add aistrix.json with \"entrypoint\": \"module:function\" (default main:run).") from e
        raise


def commit_of(root: str) -> Optional[str]:
    """GitHub names the archive folder owner-repo-<short sha>."""
    tail = root.rsplit("-", 1)[-1] if root else ""
    return tail if re.fullmatch(r"[0-9a-f]{7,40}", tail) else None


def _refused(status: int, token: Optional[str]) -> Exception:
    if status in (401, 403):
        return PermissionError("GitHub refused access to this repository" + (". Reconnect GitHub in Settings" if token else ""))
    return ConnectionError(f"GitHub answered {status}")


async def resolve(fetch, src: Source, token: Optional[str]) -> Source:
    """Pin the import to one commit, trying each branch/folder split of the
    link. GitHub's commit lookup with the sha media type answers with the
    40-character SHA only."""
    headers = {"Accept": "application/vnd.github.sha", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "aistrix-import"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    for ref, path in src.candidates or [(src.ref, src.path)]:
        resp = await fetch("GET", commit_url(src, ref), timeout=20, max_redirects=0, allowed_hosts=GITHUB_HOSTS, headers=headers)
        if resp.status_code in (404, 422):
            continue                      # not a branch, tag or commit: try a longer branch name
        if resp.status_code != 200:
            raise _refused(resp.status_code, token)
        sha = resp.content.decode("ascii", "replace").strip()
        if not re.fullmatch(r"[0-9a-f]{40}", sha):
            raise ConnectionError("GitHub didn't return a commit")
        src.ref, src.path, src.commit = ref, path, sha
        return src
    raise LookupError("Repository, branch or commit not found" + ("" if token else
                      ". For a private repository, connect GitHub in Settings first"))


async def fetch_github(fetch, src: Source, token: Optional[str]) -> bytes:
    """Download the repository archive at its resolved commit. fetch is outbound.fetch_safely."""
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "aistrix-import"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    resp = await fetch("GET", archive_url(src), timeout=60, max_redirects=3, allowed_hosts=GITHUB_HOSTS, headers=headers)
    if resp.status_code == 404:
        raise LookupError("Repository, branch or commit not found" + ("" if token else
                          ". For a private repository, connect GitHub in Settings first"))
    if resp.status_code != 200:
        raise _refused(resp.status_code, token)
    return resp.content
