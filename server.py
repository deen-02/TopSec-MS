from __future__ import annotations
import asyncio
import json
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass

from fastapi import FastAPI, HTTPException, Header, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from models import IncidentReport, ContainmentAction

app = FastAPI(title="TopSec Demo", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_SCENARIO = json.loads((Path(__file__).parent / "scenario.json").read_text(encoding="utf-8"))
_DATA_DIR = Path(__file__).parent / "data" / "reports"
_DATA_DIR.mkdir(parents=True, exist_ok=True)

_pending:   dict[str, IncidentReport] = {}
_completed: dict[str, IncidentReport] = {}
_sse_subs:  list[asyncio.Queue] = []


def _persist(r: IncidentReport) -> None:
    (_DATA_DIR / f"{r.report_id}.json").write_text(r.model_dump_json(), encoding="utf-8")


def _load() -> None:
    for p in sorted(_DATA_DIR.glob("*.json"), key=lambda x: x.stat().st_mtime):
        try:
            r = IncidentReport.model_validate_json(p.read_text(encoding="utf-8"))
            ((_completed if r.reviewer_decision else _pending))[r.report_id] = r
        except Exception:
            pass


def _sev(s: str) -> str:
    w = (s or "").split()[0].rstrip(":—-").strip()
    return w if w in {"Critical", "High", "Medium", "Low", "Informational"} else ""


def _broadcast(event: dict) -> None:
    msg = f"data: {json.dumps(event)}\n\n"
    for q in list(_sse_subs):
        try:
            q.put_nowait(msg)
        except asyncio.QueueFull:
            pass


def _summary(r: IncidentReport) -> dict:
    return {
        "report_id": r.report_id,
        "incident_id": r.incident_id,
        "incident_number": r.incident_number,
        "title": r.title,
        "classification": r.classification,
        "confidence": r.confidence,
        "severity": _sev(r.severity_assessment),
        "severity_assessment": r.severity_assessment,
        "summary": r.summary,
        "action_count": len(r.recommended_actions),
        "triage_duration_seconds": r.triage_duration_seconds,
        "generated_at": r.generated_at.isoformat(),
    }


_load()


# ── ingest ────────────────────────────────────────────────────────────────────

class IngestPayload(BaseModel):
    report: dict[str, Any]

@app.post("/api/ingest")
async def ingest(payload: IngestPayload, x_secret_token: str = Header(default="")):
    r = IncidentReport(**payload.report)
    _pending[r.report_id] = r
    _persist(r)
    return {"report_id": r.report_id, "status": "pending"}


# ── list / get ────────────────────────────────────────────────────────────────

@app.get("/api/pending")
async def list_pending():
    return [_summary(r) for r in _pending.values()]

@app.get("/api/completed")
async def list_completed():
    return [{**_summary(r), "reviewer_decision": r.reviewer_decision, "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None} for r in _completed.values()]

@app.get("/api/reports/{report_id}")
async def get_report(report_id: str):
    r = _pending.get(report_id) or _completed.get(report_id)
    if not r:
        raise HTTPException(404, "Not found")
    return r.model_dump(mode="json")


# ── approve ───────────────────────────────────────────────────────────────────

class ApprovalPayload(BaseModel):
    approved_action_ids: list[str]
    rejected_action_ids: list[str]
    reviewer_notes: str = ""
    execute_now: bool = False

@app.post("/api/reports/{report_id}/approve")
async def approve(report_id: str, payload: ApprovalPayload, x_secret_token: str = Header(default="")):
    r = _pending.get(report_id)
    if not r:
        raise HTTPException(404, "Not found or already reviewed")
    for a in r.recommended_actions:
        if a.action_id in payload.approved_action_ids:
            a.approved = True
        elif a.action_id in payload.rejected_action_ids:
            a.approved = False
    approved = sum(1 for a in r.recommended_actions if a.approved)
    r.reviewer_notes = payload.reviewer_notes
    r.reviewed_at = datetime.utcnow()
    r.reviewer_decision = "Approved" if approved == len(r.recommended_actions) else "PartialApproval" if approved else "Rejected"
    _completed[report_id] = r
    del _pending[report_id]
    _persist(r)
    return {"report_id": report_id, "reviewer_decision": r.reviewer_decision, "approved_actions": approved}

@app.post("/api/reports/{report_id}/reopen")
async def reopen(report_id: str, x_secret_token: str = Header(default="")):
    r = _completed.get(report_id)
    if not r:
        raise HTTPException(404, "Not found")
    r.reviewer_decision = r.reviewer_notes = ""
    r.reviewed_at = None
    for a in r.recommended_actions:
        a.approved = None
        a.executed_at = None
        a.execution_result = ""
    _pending[report_id] = r
    del _completed[report_id]
    _persist(r)
    return {"report_id": report_id, "status": "reopened"}

@app.delete("/api/reports/{report_id}")
async def dismiss(report_id: str, x_secret_token: str = Header(default="")):
    removed = False
    for store in (_pending, _completed):
        if report_id in store:
            del store[report_id]
            removed = True
    p = _DATA_DIR / f"{report_id}.json"
    if p.exists():
        p.unlink()
    if not removed:
        raise HTTPException(404, "Not found")
    return {"report_id": report_id, "status": "dismissed"}

@app.get("/api/reports/{report_id}/status")
async def get_status(report_id: str):
    r = _completed.get(report_id) or _pending.get(report_id)
    if not r:
        raise HTTPException(404, "Not found")
    return {
        "report_id": report_id,
        "reviewer_decision": r.reviewer_decision,
        "rollback_result": r.rollback_result,
        "actions": [{"action_id": a.action_id, "action_type": a.action_type, "target": a.target, "approved": a.approved, "executed_at": a.executed_at.isoformat() if a.executed_at else None, "result": a.execution_result} for a in r.recommended_actions],
    }


# ── demo trigger ──────────────────────────────────────────────────────────────

_SCENARIO_OVERRIDES: dict[str, dict] = {
    "credential_stuffing": {"incident_number": 2001, "title": "Credential Stuffing Attack — Token Theft — Lateral Movement via WMI", "severity_assessment": "High"},
    "ransomware":          {"incident_number": 2002, "title": "Ransomware Precursor — Cobalt Strike Beacon — SMB Enumeration",        "severity_assessment": "Critical"},
    "mfa_bypass":          {"incident_number": 2003, "title": "MFA Bypass via SIM Swap — Adversary-in-the-Middle Token Capture",     "severity_assessment": "High"},
    "lateral_movement":    {"incident_number": 2004, "title": "Lateral Movement via Pass-the-Hash — WMI Remote Execution",           "severity_assessment": "High"},
    "insider_threat":      {"incident_number": 2005, "title": "Insider Threat — Bulk Data Exfiltration via SharePoint",              "severity_assessment": "Medium"},
    "ai_prompt_injection": {"incident_number": 2006, "title": "AI Prompt Injection via Copilot — Tenant Data Leak",                  "severity_assessment": "Critical"},
}

@app.post("/api/demo/reset")
async def demo_reset():
    _pending.clear()
    _completed.clear()
    for p in _DATA_DIR.glob("*.json"):
        try: p.unlink()
        except Exception: pass
    return {"status": "reset"}

@app.post("/api/demo/trigger")
async def demo_trigger(scenario: str = "credential_stuffing"):
    try:
        inc  = _SCENARIO["incident"]
        resp = _SCENARIO["response"]
        inv  = _SCENARIO.get("investigation", {})
        echo = _SCENARIO.get("echo_rule")
        ovr  = _SCENARIO_OVERRIDES.get(scenario, {})

        actions = [
            ContainmentAction(
                action_type=a.get("action_type") or a.get("action", ""),
                target=a.get("target", ""),
                detail=a.get("detail", ""),
                reason=a.get("note") or a.get("reason", ""),
            )
            for a in resp.get("recommended_actions", [])
        ]
        enrichments = [
            {"entity": name, **data}
            for name, data in _SCENARIO.get("enrichments", {}).items()
        ]
        # Build mitre_mappings dropping extra fields not in the model
        mitre_raw = inv.get("mitre_mappings", [])
        mitre_clean = [
            {k: v for k, v in m.items() if k in {"technique_id", "technique_name", "tactic", "confidence", "description", "evidence"}}
            for m in mitre_raw
        ]
        r = IncidentReport(
            incident_id=inc.get("incident_id", "demo-001"),
            incident_number=ovr.get("incident_number", inc.get("incident_number", 1042)),
            title=ovr.get("title", inc.get("title", "Demo Incident")),
            classification=inv.get("classification", "TruePositive"),
            confidence=float(inv.get("confidence", 0.95)),
            severity_assessment=ovr.get("severity_assessment", resp.get("severity_assessment", "High")),
            summary=inv.get("summary", resp.get("summary", "")),
            timeline=inv.get("attack_timeline", []),
            entity_enrichments=enrichments,
            mitre_mappings=mitre_clean,
            ioc_list=inv.get("ioc_list", []),
            recommended_actions=actions,
            echo_rule=echo,
            triage_duration_seconds=8.3,
            raw_events=inc.get("raw_events", []),
            foundry_iq_results=inv.get("foundry_iq_results", []),
        )
        _pending[r.report_id] = r
        _persist(r)
        _broadcast({"type": "report_ready", "report_id": r.report_id, "incident_number": r.incident_number})
        return {"status": "triggered", "scenario": scenario, "report_id": r.report_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"demo_trigger failed: {e}")


# ── SSE stream ────────────────────────────────────────────────────────────────

@app.get("/api/stream")
async def stream(request: Request):
    q: asyncio.Queue = asyncio.Queue(maxsize=50)
    _sse_subs.append(q)
    async def gen():
        try:
            yield 'data: {"type":"connected"}\n\n'
            while True:
                if await request.is_disconnected():
                    break
                try:
                    yield await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            _sse_subs.remove(q)
    return StreamingResponse(gen(), media_type="text/event-stream")


# ── IOCs ──────────────────────────────────────────────────────────────────────

@app.get("/api/iocs")
async def list_iocs():
    seen: set[str] = set()
    out = []
    for r in sorted(list(_pending.values()) + list(_completed.values()), key=lambda x: x.generated_at, reverse=True):
        for ioc in (r.ioc_list or []):
            if ioc and ioc not in seen:
                seen.add(ioc)
                out.append({"value": ioc, "incident_number": r.incident_number, "title": r.title, "classification": r.classification, "report_id": r.report_id, "generated_at": r.generated_at.isoformat()})
    return out


# ── Foundry IQ (offline: returns canned MITRE results) ────────────────────────

class HuntPayload(BaseModel):
    query: str

@app.post("/api/hunt/query")
async def hunt_query(payload: HuntPayload):
    return {
        "query": payload.query,
        "results": [
            {"technique_id": "T1110", "name": "Brute Force", "tactic": "Credential Access", "description": "Adversaries may use brute force techniques to gain access to accounts when passwords are unknown or when password hashes are obtained.", "score": 0.97},
            {"technique_id": "T1078", "name": "Valid Accounts", "tactic": "Defense Evasion", "description": "Adversaries may obtain and abuse credentials of existing accounts as a means of gaining Initial Access.", "score": 0.91},
            {"technique_id": "T1021", "name": "Remote Services", "tactic": "Lateral Movement", "description": "Adversaries may use valid accounts to log into a service that accepts remote connections.", "score": 0.85},
        ],
    }


# ── AI Analyst (offline: canned response; live if Azure keys set) ─────────────

class AnalystPayload(BaseModel):
    message: str
    incident_context: dict = {}

@app.post("/api/analyst/chat")
async def analyst_chat(payload: AnalystPayload):
    import os
    key = os.getenv("AZURE_OPENAI_API_KEY", "")
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "")
    deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4.1-mini")
    api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2024-12-01-preview")

    if key and endpoint:
        try:
            import httpx
            async with httpx.AsyncClient(timeout=30) as c:
                r = await c.post(
                    f"{endpoint}openai/deployments/{deployment}/chat/completions?api-version={api_version}",
                    headers={"api-key": key, "Content-Type": "application/json"},
                    json={"messages": [{"role": "system", "content": "You are TopSec AI Analyst — a senior SOC analyst. Be specific, cite MITRE T-numbers, include KQL when relevant."}, {"role": "user", "content": payload.message}], "max_tokens": 900, "temperature": 0.7},
                )
                if r.status_code == 200:
                    return {"response": r.json()["choices"][0]["message"]["content"], "sources": [], "ioc_hits": []}
        except Exception:
            pass

    return {
        "response": (
            "**T1110 — Brute Force (Credential Access)**\n\n"
            "The attacker is systematically attempting credentials against exposed RDP/SSH services. "
            "Key indicators: repeated 4625 (failed logon) events from a single external IP, followed by a successful 4624 logon. "
            "The switch to a valid account maps to **T1078 (Valid Accounts)** for persistence.\n\n"
            "**Recommended KQL**\n```kql\nSecurityEvent\n| where EventID == 4625\n| summarize Attempts=count() by IpAddress, Account, bin(TimeGenerated, 5m)\n| where Attempts > 10\n```\n\n"
            "**Next steps**: isolate the source IP via NSG rule, rotate credentials for the affected account, review lateral movement via T1021."
        ),
        "sources": [{"technique_id": "T1110", "name": "Brute Force", "tactic": "Credential Access"}],
        "ioc_hits": [],
    }


# ── Graceful stubs for Azure-only endpoints ───────────────────────────────────

@app.get("/api/tenant/status")
async def tenant_status(x_secret_token: str = Header(default="")):
    return {"incidents": [], "nsg_blocks": [], "watchlist_count": 0, "local_pending": len(_pending), "local_completed": len(_completed)}

@app.get("/api/honeypot/stats")
async def honeypot_stats():
    return {"last_run": None, "seen_count": 0, "triaged_count": 0, "recent_incidents": []}

@app.post("/api/honeypot/trigger")
async def honeypot_trigger(x_secret_token: str = Header(default="")):
    return {"status": "offline", "message": "Honeypot ingestor requires live Azure connection"}

@app.delete("/api/nsg/{nsg_name}/rules/{rule_name}")
async def delete_nsg_rule(nsg_name: str, rule_name: str, x_secret_token: str = Header(default="")):
    return {"rule_name": rule_name, "nsg": nsg_name, "status": "skipped (offline mode)"}

@app.post("/api/reports/{report_id}/rollback")
async def rollback(report_id: str, x_secret_token: str = Header(default="")):
    return {"report_id": report_id, "status": "skipped (offline mode)"}

@app.get("/login")
async def login():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/")


# ── serve UI ──────────────────────────────────────────────────────────────────

try:
    app.mount("/", StaticFiles(directory=str(Path(__file__).parent / "ui"), html=True), name="ui")
except Exception:
    pass
