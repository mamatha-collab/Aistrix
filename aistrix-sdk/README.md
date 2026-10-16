# Aistrix Python SDK & CLI

Run your Aistrix apps from code or the terminal.

```bash
pip install aistrix
export AISTRIX_API_KEY=ak_live_...        # create one in Dev Studio → Deploy → API keys
export AISTRIX_API_URL=https://api.aistrix.com
```

## Run an app

```python
from aistrix import AistrixClient

client = AistrixClient()

# Free-text input
print(client.run(APP_ID, "Summarise our Q3 churn drivers").output)

# Apps with parameters: pass fields (names are on the app's API Docs page,
# or in client.get_app(APP_ID)["parameters"])
result = client.run(APP_ID, fields={"company": "Acme", "employees": 120})

# Structured Output apps: `data` is the parsed, schema-validated JSON
print(result.data)          # {"score": 82, "tier": "high", ...}

# Stream tokens
for token in client.stream(APP_ID, "Write a cold email for Acme"):
    print(token, end="", flush=True)

# Files: PDF, XLSX, DOCX, CSV, TXT, JSON, MD (max 10 MB).
# Files too large for one model call are split, analysed and combined server-side.
client.run(APP_ID, "Total revenue by region", file="sales.xlsx")
client.run(APP_ID, "Extract the parties", file=("contract.pdf", pdf_bytes))
```

## Batches

Batches run on the server, so they keep going if your script exits.

```python
batch = client.create_batch(APP_ID, [{"company": "Acme"}, {"company": "Globex"}])
# or: client.create_batch(APP_ID, csv=open("leads.csv").read())
print(batch.warnings)        # e.g. "Platform limits allow 20 more runs right now…"

batch = client.wait_for_batch(batch.id, on_progress=lambda b: print(b.completed, "/", b.total))
for row in client.batch_results(batch.id):
    print(row["idx"], row["status"], row["data"] or row["output"] or row["error"])

open("results.csv", "w").write(client.batch_results_csv(batch.id))

if batch.status == "stopped":          # hit a rate limit or plan quota
    client.retry_batch(batch.id)       # resume the remaining rows later
```

Pass `webhook_url=` to `create_batch` to get a POST when the batch finishes.

## Errors

| Exception | When |
|---|---|
| `AuthenticationError` | Invalid/revoked key (401), or the key is restricted to other apps (403) |
| `PaymentRequiredError` | Paid app without an active purchase, or the plan's run quota is used up (402) |
| `NotFoundError` | App not found / not published, or batch isn't yours (404) |
| `ContractError` | Input fields don't match, or output failed the app's schema — see `.errors` (413/415/422) |
| `RateLimitError` | Platform rate limit (429). Add your own provider key in Aistrix to remove it |
| `APIError` | Anything else (provider errors, timeouts) |

All inherit from `AistrixError` and carry `.status` and `.errors`.

## CLI

```bash
aistrix configure                                   # saves API URL + key
aistrix apps
aistrix run APP_ID -i "Hello"
aistrix run APP_ID -f company=Acme -f employees=120 --json
aistrix run APP_ID -i "Summarise" --file report.pdf --no-stream
aistrix batch APP_ID leads.csv -o results.csv
aistrix batch-retry BATCH_ID
aistrix usage
```

## Upgrading from 0.1

`run()` now returns a `RunResult` instead of yielding tokens; use `stream()` for
token streaming. The client reads `AISTRIX_API_KEY` / `AISTRIX_API_URL`, and
`AistrixClient(api_url, token)` still works via keyword `token=`.
