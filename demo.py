"""
TopSec Agent — Offline Demo
Run: python demo.py
Then open http://localhost:8000 in your browser.
No Azure credentials required.
"""
from __future__ import annotations
import argparse, asyncio, json, sys, threading, time, webbrowser
from pathlib import Path

SCENARIO = json.loads((Path(__file__).parent / "scenario.json").read_text(encoding="utf-8"))
PORT = 8000

# Clear any reports left over from a previous run
_DATA = Path(__file__).parent / "data" / "reports"
if _DATA.exists():
    for _f in _DATA.glob("*.json"):
        _f.unlink()


def _build_report() -> dict:
    inc  = SCENARIO["incident"]
    resp = SCENARIO["response"]
    inv  = SCENARIO.get("investigation", {})
    echo = SCENARIO.get("echo_rule")
    import uuid
    from datetime import datetime
    actions = [
        {
            "action_id": str(uuid.uuid4()),
            "action_type": a.get("action_type") or a.get("action", ""),
            "target": a.get("target", ""),
            "detail": a.get("detail", ""),
            "reason": a.get("note") or a.get("reason", ""),
            "approved": None,
            "executed_at": None,
            "execution_result": "",
        }
        for a in resp.get("recommended_actions", [])
    ]
    enrichments = [
        {"entity": name, **data}
        for name, data in SCENARIO.get("enrichments", {}).items()
    ]
    return {
        "report_id": str(uuid.uuid4()),
        "incident_id": inc.get("incident_id", "demo-001"),
        "incident_number": inc.get("incident_number", 1042),
        "title": inc.get("title", "Demo Incident"),
        "classification": inv.get("classification", resp.get("classification", "TruePositive")),
        "confidence": inv.get("confidence", resp.get("confidence", 0.95)),
        "severity_assessment": resp.get("severity_assessment", "High"),
        "summary": inv.get("summary", resp.get("summary", "")),
        "timeline": inv.get("attack_timeline", []),
        "entity_enrichments": enrichments,
        "mitre_mappings": inv.get("mitre_mappings", []),
        "ioc_list": inv.get("ioc_list", resp.get("ioc_list", [])),
        "recommended_actions": actions,
        "echo_rule": echo,
        "triage_duration_seconds": 8.3,
        "raw_events": inc.get("raw_events", []),
        "foundry_iq_results": inv.get("foundry_iq_results", []),
        "enrichment_summary": resp.get("enrichment_summary", ""),
        "generated_at": datetime.utcnow().isoformat(),
        "reviewer_decision": "",
        "reviewer_notes": "",
        "reviewed_at": None,
        "rollback_result": None,
        "containment_result": None,
        "eradication_result": None,
        "recovery_result": None,
    }


async def _wait_for_server() -> None:
    import httpx
    for _ in range(30):
        try:
            async with httpx.AsyncClient() as c:
                r = await c.get(f"http://localhost:{PORT}/api/pending", timeout=3)
                r.raise_for_status()
                return
        except Exception:
            await asyncio.sleep(0.3)
    raise RuntimeError("Server did not start in time")


def _start_server():
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=PORT, log_level="error")


async def main():
    print("\n" + "=" * 56)
    print("  TopSec Agent  -  Autonomous Tier-1 SOC Analyst")
    print("=" * 56 + "\n")
    print("Mode     : OFFLINE DEMO (no Azure credentials required)")
    print("Scenario : Credential Stuffing -> Token Theft -> Lateral Movement via WMI\n")

    t0 = time.monotonic()
    for i, phase in enumerate([
        "Intake        - fetching incident #1042 + Sentinel KQL context",
        "Enrichment    - VirusTotal / AbuseIPDB / Entra ID",
        "Investigation - ATT&CK mapping via Foundry IQ (47 techniques)",
        "Response      - incident report + containment actions",
        "ECHO          - synthesizing new KQL detection rule",
    ], 1):
        print(f"  [{i}/5] {phase}...")
        await asyncio.sleep(0.35)

    report = _build_report()
    inc_num = _ARGS.incident if _ARGS.incident else report['incident_number']
    print("\n" + "=" * 56)
    print(f"  Incident : #{inc_num} - {report['title'][:48]}")
    print(f"  Result   : {report['classification']}  ({report['confidence']*100:.0f}% confidence)")
    print(f"  Severity : {report['severity_assessment']}")
    mitres = [m['technique_id'] for m in report.get('mitre_mappings', [])]
    print(f"  ATT&CK   : {', '.join(mitres[:4])}")
    print(f"  IOCs     : {', '.join(report.get('ioc_list', [])[:3])}")
    print(f"  Actions  : {len(report['recommended_actions'])} proposed")
    echo = report.get("echo_rule")
    if echo:
        print(f"  ECHO     : {echo.get('rule_name', '')}")
    print("=" * 56)

    print("\nStarting approval server...")
    threading.Thread(target=_start_server, daemon=True).start()
    await _wait_for_server()
    url = f"http://localhost:{PORT}"
    print(f"Approval UI  ->  {url}")
    webbrowser.open(url)
    print("Press Ctrl+C to stop.\n")
    try:
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        print("\nDemo stopped.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--incident", type=int, default=None, help="Override incident number shown in terminal output")
    _ARGS = ap.parse_args()
    asyncio.run(main())
