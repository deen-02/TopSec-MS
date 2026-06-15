from __future__ import annotations
from datetime import datetime
from typing import Any
import uuid
from pydantic import BaseModel, Field


class ContainmentAction(BaseModel):
    action_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    action_type: str = ""
    target: str = ""
    detail: str = ""
    reason: str = ""
    approved: bool | None = None
    executed_at: datetime | None = None
    execution_result: str = ""


class MitreMapping(BaseModel):
    technique_id: str = ""
    technique_name: str = ""
    tactic: str = ""
    confidence: float = 0.0
    description: str = ""


class IncidentReport(BaseModel):
    report_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    incident_id: str = ""
    incident_number: int = 0
    title: str = ""
    classification: str = ""
    confidence: float = 0.0
    severity_assessment: str = ""
    summary: str = ""
    timeline: list[Any] = []
    entity_enrichments: list[Any] = []
    mitre_mappings: list[MitreMapping] = []
    ioc_list: list[str] = []
    recommended_actions: list[ContainmentAction] = []
    echo_rule: dict[str, Any] | None = None
    containment_result: dict[str, Any] | None = None
    eradication_result: dict[str, Any] | None = None
    recovery_result: dict[str, Any] | None = None
    triage_duration_seconds: float | None = None
    generated_at: datetime = Field(default_factory=datetime.utcnow)
    reviewer_decision: str = ""
    reviewer_notes: str = ""
    reviewed_at: datetime | None = None
    rollback_result: dict[str, Any] | None = None
    raw_events: list[dict[str, Any]] = []
    foundry_iq_results: list[dict[str, Any]] = []
    enrichment_summary: str = ""
