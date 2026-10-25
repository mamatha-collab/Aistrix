"""Reference workflows a developer can install and run end to end: invoice
processing, support email, and a business-data integration. Each one creates
its apps as drafts (typed inputs and outputs) and a wired developer workflow
with approval steps, branches and API steps that deliver to the developer's
own test destinations (main.py: /v1/test-destinations). Pure data, no I/O.
"""
from typing import Callable

MODEL = {"ai_provider": "claude", "ai_model": "claude-haiku-5-5"}


def field(name: str, ftype: str = "string", description: str = "", *, required: bool = True, **extra) -> dict:
    return {"field": name, "type": ftype, "description": description, "required": required, **extra}


def wire(source: str, transform: str = "") -> dict:
    return {"from": source, **({"transform": transform} if transform else {})}


def _app(key: str, name: str, emoji: str, description: str, prompt: str, inputs: list, outputs: list) -> dict:
    return {"key": key, "name": name, "emoji": emoji, "description": description, "system_prompt": prompt,
            "output_type": "json", **MODEL,
            "blueprint": {"input_schema": {"fields": inputs}, "output_schema": {"fields": outputs},
                          "output_contract": {"format": "json"},
                          "contract": {"data_class": "confidential", "side_effects": "none"}}}


NEVER_GUESS = ("Use only what the input says. When something isn't there, use null (or an empty list) — "
               "never guess or invent values. Return only the JSON object.")

INVOICE_READER = _app(
    "invoice_reader", "Invoice reader", "🧾", "Reads an invoice's text into structured fields.",
    "You read supplier invoices for an accounts-payable team. Extract the fields below from the invoice text. "
    "Amounts are numbers without currency symbols or thousands separators. Dates are ISO 8601 (YYYY-MM-DD). "
    "List every required field you could not find in missing_fields (vendor, invoice_number, invoice_date, "
    "due_date, currency, total). " + NEVER_GUESS,
    [field("invoice_text", description="The invoice as text (pasted, emailed or from OCR)")],
    [field("vendor", description="Supplier name"), field("invoice_number"), field("invoice_date", description="YYYY-MM-DD"),
     field("due_date", description="YYYY-MM-DD"), field("currency", description="ISO 4217 code, e.g. USD"),
     field("subtotal", "number"), field("tax", "number"), field("total", "number"),
     field("line_item_count", "number"), field("missing_fields", "string_array", "Required fields not found")])

INVOICE_CHECKER = _app(
    "invoice_checker", "Invoice checker", "✅", "Decides whether an extracted invoice can go to accounting.",
    "You check extracted invoices before they are booked. Decide: \"reject\" when the total is missing, zero or "
    "negative, or there is no invoice number; \"review\" when any required field is missing, the total is above "
    "5000, or the due date is already past or within 3 days; otherwise \"approve\". List every reason in issues "
    "and give a one-sentence note for the finance team. " + NEVER_GUESS,
    [field("vendor"), field("invoice_number"), field("total", "number"), field("due_date"),
     field("missing_fields", "string_array", required=False)],
    [field("decision", "enum", enum_values=["approve", "review", "reject"]), field("issues", "string_array"),
     field("note")])

SUPPORT_TRIAGE = _app(
    "support_triage", "Support triage", "🗂️", "Sorts an incoming support email by topic and urgency.",
    "You triage customer support emails. Pick the category and urgency. Urgency is \"high\" only for outages, "
    "data loss, security issues, payment failures or legal threats; \"low\" for feedback and questions that can "
    "wait. customer_email is the sender's address. summary is two sentences: the problem and what the customer "
    "asks for. " + NEVER_GUESS,
    [field("from_email"), field("subject"), field("body")],
    [field("category", "enum", enum_values=["billing", "technical", "account", "feedback", "other"]),
     field("urgency", "enum", enum_values=["low", "normal", "high"]), field("customer_email"),
     field("summary"), field("needs_human", "boolean", "True when an agent must act, not just reply")])

SUPPORT_WRITER = _app(
    "support_writer", "Support reply writer", "✉️", "Drafts a reply to a triaged support email.",
    "You draft replies for a support team; a person reviews every draft before it is sent. Be warm, specific "
    "and brief (under 150 words). Acknowledge the problem from the summary, say what happens next, and never "
    "promise refunds, dates or fixes that the summary doesn't confirm. reply_subject starts with \"Re: \" "
    "followed by the original subject. Return only the JSON object.",
    [field("customer_email"), field("subject"), field("summary"), field("category")],
    [field("reply_subject"), field("reply_body")])

SALES_ANALYST = _app(
    "sales_analyst", "Sales data analyst", "📈", "Summarises a sales export and flags anomalies.",
    "You analyse a JSON export of orders (rows with order_id, date, product, region, units, unit_price). "
    "Compute total_revenue as the sum of units × unit_price over valid rows and order_count as the number of "
    "valid rows. A row is an anomaly when units is zero or negative, unit_price is zero or negative, or a value "
    "is more than 10 times the median for that product; list each as \"<order_id>: <reason>\" and leave it out "
    "of the totals. top_products are the three products with the highest revenue, highest first. period is "
    "the month the rows cover (YYYY-MM). summary is two sentences for a sales manager. " + NEVER_GUESS,
    [field("rows_json", description="The export as JSON text")],
    [field("period"), field("total_revenue", "number"), field("order_count", "number"),
     field("top_products", "string_array"), field("anomalies", "string_array"), field("summary")])


def _post(step_id: str, name: str, destination: Callable[[str], str], dest: str, body_map: dict, **extra) -> dict:
    return {"id": step_id, "step_type": "api_call", "app_name": name, "api_method": "POST",
            "api_url": destination(dest), "api_body_map": body_map, **extra}


def build(key: str, destination: Callable[[str], str]) -> dict:
    """The workflow `key` with its apps; destination(name) gives the URL of
    the installing developer's test destination `name`."""
    if key == "invoice_processing":
        return {
            "name": "Invoice processing", "emoji": "🧾",
            "description": "Read an invoice, check it, get finance approval, then book it in accounting — "
                           "or send it to the exceptions queue when it can't be booked.",
            "apps": [INVOICE_READER, INVOICE_CHECKER],
            "trigger": {"type": "manual", "fields": [field("invoice_text"), field("received_from", required=False)]},
            "steps": [
                {"id": "s1", "app": "invoice_reader", "app_name": "Read invoice",
                 "input_map": {"invoice_text": wire("trigger.invoice_text")}},
                {"id": "s2", "app": "invoice_checker", "app_name": "Check invoice",
                 "input_map": {"vendor": wire("s1.vendor"), "invoice_number": wire("s1.invoice_number"),
                               "total": wire("s1.total"), "due_date": wire("s1.due_date"),
                               "missing_fields": wire("s1.missing_fields")}},
                {"id": "s3", "step_type": "human_approval", "approval_type": "approve", "app_name": "Finance approval",
                 "run_if": {"from": "s2.decision", "op": "not_equals", "value": "reject", "label": "Can be booked"}},
                _post("s4", "Book in accounting", destination, "accounting",
                      {"vendor": wire("s1.vendor"), "invoice_number": wire("s1.invoice_number"),
                       "invoice_date": wire("s1.invoice_date"), "due_date": wire("s1.due_date"),
                       "currency": wire("s1.currency"), "total": wire("s1.total"),
                       "checker_note": wire("s2.note"), "issues": wire("s2.issues")},
                      run_if={"from": "s2.decision", "op": "not_equals", "value": "reject", "label": "Approved for booking"}),
                _post("s5", "Send to exceptions", destination, "invoice-exceptions",
                      {"vendor": wire("s1.vendor"), "invoice_number": wire("s1.invoice_number"),
                       "issues": wire("s2.issues"), "note": wire("s2.note")},
                      run_if={"from": "s2.decision", "op": "equals", "value": "reject", "label": "Rejected"}),
            ],
            "sample_input": {"invoice_text": SAMPLE_INVOICE, "received_from": "ap@northwind.example"},
        }
    if key == "support_email":
        return {
            "name": "Support email", "emoji": "✉️",
            "description": "Triage a support email, escalate urgent ones at once, draft a reply, let an agent "
                           "edit and approve it, then send it to the outbox.",
            "apps": [SUPPORT_TRIAGE, SUPPORT_WRITER],
            "trigger": {"type": "manual", "fields": [field("from_email"), field("subject"), field("body")]},
            "steps": [
                {"id": "s1", "app": "support_triage", "app_name": "Triage email",
                 "input_map": {"from_email": wire("trigger.from_email"), "subject": wire("trigger.subject"),
                               "body": wire("trigger.body")}},
                _post("s2", "Escalate urgent", destination, "support-escalations",
                      {"customer_email": wire("s1.customer_email"), "subject": wire("trigger.subject"),
                       "summary": wire("s1.summary"), "category": wire("s1.category")},
                      run_if={"from": "s1.urgency", "op": "equals", "value": "high", "label": "Urgent"}),
                {"id": "s3", "app": "support_writer", "app_name": "Draft reply",
                 "input_map": {"customer_email": wire("s1.customer_email"), "subject": wire("trigger.subject"),
                               "summary": wire("s1.summary"), "category": wire("s1.category")}},
                {"id": "review", "step_type": "human_approval", "approval_type": "edit", "app_name": "Agent review"},
                _post("s5", "Send reply", destination, "support-outbox",
                      {"to": wire("s1.customer_email"), "subject": wire("review.reply_subject"),
                       "body": wire("review.reply_body")}),
            ],
            "sample_input": {"from_email": "dana@acme.example", "subject": "Charged twice this month",
                             "body": SAMPLE_EMAIL},
        }
    if key == "sales_data_sync":
        return {
            "name": "Sales data sync", "emoji": "📈",
            "description": "Pull last month's orders from a business system, summarise them, hold anomalies "
                           "for review, and push the summary to the CRM.",
            "apps": [SALES_ANALYST],
            "trigger": {"type": "manual", "fields": []},
            "steps": [
                {"id": "s1", "step_type": "api_call", "app_name": "Fetch orders", "api_method": "GET",
                 "api_url": destination("sales-data")},
                {"id": "s2", "app": "sales_analyst", "app_name": "Analyse sales",
                 "input_map": {"rows_json": wire("s1.text")}},
                {"id": "s3", "step_type": "human_approval", "approval_type": "approve", "app_name": "Review anomalies",
                 "run_if": {"from": "s2.anomalies", "op": "not_empty", "label": "Anomalies found"}},
                _post("s4", "Update CRM", destination, "crm",
                      {"period": wire("s2.period"), "total_revenue": wire("s2.total_revenue"),
                       "order_count": wire("s2.order_count"), "top_products": wire("s2.top_products"),
                       "anomalies": wire("s2.anomalies"), "summary": wire("s2.summary")}),
            ],
            "sample_input": {},
        }
    raise KeyError(key)


CATALOG = ("invoice_processing", "support_email", "sales_data_sync")
# Test destinations: names the workflows deliver to, and the one they read.
DESTINATIONS = {
    "accounting": "Booked invoices", "invoice-exceptions": "Invoices that couldn't be booked",
    "support-escalations": "Urgent support emails", "support-outbox": "Approved support replies",
    "crm": "Monthly sales summaries",
}
DATASETS = {"sales-data": "Sample monthly order export (read with GET)"}

SAMPLE_INVOICE = """NORTHWIND SUPPLIES LTD — INVOICE
Invoice no: NW-2026-0418        Invoice date: 2026-10-02        Due: 2026-11-01
Bill to: Aistrix Demo Co.

Qty  Description                 Unit     Amount
 40  Recycled copy paper (box)    18.50     740.00
 12  Toner cartridge, black       62.00     744.00
  3  Desk organiser               24.00      72.00

Subtotal 1,556.00   VAT (20%) 311.20   TOTAL DUE USD 1,867.20"""

SAMPLE_EMAIL = """Hi,
I was charged twice for my Pro subscription this month (two payments of $49 on Oct 3).
Can you refund the duplicate? My account email is dana@acme.example.
Thanks, Dana"""

SALES_ROWS = [
    {"order_id": "SO-1001", "date": "2026-09-02", "product": "Starter plan", "region": "EU", "units": 12, "unit_price": 29.0},
    {"order_id": "SO-1002", "date": "2026-09-03", "product": "Pro plan", "region": "US", "units": 5, "unit_price": 99.0},
    {"order_id": "SO-1003", "date": "2026-09-05", "product": "Team plan", "region": "US", "units": 2, "unit_price": 249.0},
    {"order_id": "SO-1004", "date": "2026-09-08", "product": "Pro plan", "region": "EU", "units": 7, "unit_price": 99.0},
    {"order_id": "SO-1005", "date": "2026-09-11", "product": "Starter plan", "region": "APAC", "units": 9, "unit_price": 29.0},
    {"order_id": "SO-1006", "date": "2026-09-14", "product": "Onboarding pack", "region": "US", "units": 3, "unit_price": 450.0},
    {"order_id": "SO-1007", "date": "2026-09-17", "product": "Pro plan", "region": "APAC", "units": 4, "unit_price": 99.0},
    {"order_id": "SO-1008", "date": "2026-09-19", "product": "Team plan", "region": "EU", "units": 1, "unit_price": 249.0},
    {"order_id": "SO-1009", "date": "2026-09-22", "product": "Starter plan", "region": "US", "units": -3, "unit_price": 29.0},
    {"order_id": "SO-1010", "date": "2026-09-24", "product": "Pro plan", "region": "US", "units": 120, "unit_price": 99.0},
    {"order_id": "SO-1011", "date": "2026-09-27", "product": "Onboarding pack", "region": "EU", "units": 2, "unit_price": 450.0},
    {"order_id": "SO-1012", "date": "2026-09-29", "product": "Team plan", "region": "APAC", "units": 3, "unit_price": 249.0},
]
