"""TypedDict definitions for openswissdata payloads.

These mirror the shapes returned by the live MCP tools at
https://mcp.openswissdata.com/jsonrpc — kept in sync with
``src/mcp/tools/*.ts`` in the upstream repo.

The SDK returns plain dicts (compatible with ``json.dumps`` and
``pandas.DataFrame.from_records``); these types just give static checkers
something to verify against.
"""

from __future__ import annotations

from typing import Literal, TypedDict

Lang = Literal["fr", "de", "it", "en"]
ClassificationScheme = Literal[
    "NOGA_2008",
    "NOGA_2025",
    "NACE_2.0",
    "NACE_2.1",
    "ISIC_4",
]


# -- TARES ------------------------------------------------------------------


class DutyMfn(TypedDict):
    value: float | None
    unit: str | None
    currency: str | None


class DesignationsAll(TypedDict):
    fr: str
    de: str
    it: str
    en: str


class TariffLookupResult(TypedDict):
    hs8: str
    hs6: str
    chapter: str
    heading: str
    designation: str
    designations_all: DesignationsAll
    unit_stat: str
    duty_mfn: DutyMfn
    preferential_regimes: dict[str, float | str]
    restrictions_codes: list[str]
    customs_relief_codes: list[str]
    valid_from: str
    source_url: str
    disclaimer: str


class TariffSemanticHit(TypedDict):
    hs_code: str
    description: str
    score: float


class TariffSemanticSearchResult(TypedDict):
    query: str
    hits: list[TariffSemanticHit]
    count: int
    model: str
    disclaimer: str


class TariffChangelogChange(TypedDict):
    from_version: str
    to_version: str
    field: str
    old_value: str | None
    new_value: str | None
    recorded_at: int


class TariffChangelogCurrent(TypedDict):
    duty_mfn_value: float | None
    duty_mfn_unit: str | None
    duty_mfn_currency: str | None
    designation_fr: str | None
    valid_from: str | None


class TariffChangelogResult(TypedDict):
    hs_code: str
    current: TariffChangelogCurrent
    changes: list[TariffChangelogChange]
    versions_observed: list[str]
    source_note: str


# -- Classifications --------------------------------------------------------


class CrossWalkMapping(TypedDict):
    source_code: str
    target_code: str
    mapping_type: str
    notes: str


class CrossWalkResult(TypedDict):
    source_scheme: ClassificationScheme
    target_scheme: ClassificationScheme
    source_code: str
    mappings: list[CrossWalkMapping]
    count: int


class ClassifyTextHit(TypedDict):
    code: str
    label_fr: str
    score: float


class ClassifyTextResult(TypedDict, total=False):
    query: str
    scheme_requested: Literal["NOGA_2025", "NACE_2.1"]
    scheme_returned: Literal["NOGA_2025"]
    hits: list[ClassifyTextHit]
    count: int
    model: str
    degraded: bool


# -- FINMA ------------------------------------------------------------------


class KycMatch(TypedDict):
    entity_type: str
    name: str
    uid: str | None
    lei: str | None
    licence_type: str
    status: str
    canton: str | None
    city: str
    is_warning_listed: bool
    source_url: str


class KycWarning(TypedDict):
    name: str
    warning_type: str
    category: str
    date_added: str
    source_url: str


class KycCheckResult(TypedDict):
    query: str
    registry_matches: list[KycMatch]
    warning_matches: list[KycWarning]
    match_count: int
    warning_count: int


class FinmaSearchMatch(TypedDict):
    name: str
    uid: str | None
    lei: str | None
    entity_type: str
    licence_type: str
    status: str
    city: str
    canton: str | None
    is_warning_listed: bool
    source_url: str
    score: float


class FinmaSearchWarning(TypedDict):
    name: str
    warning_type: str
    category: str
    date_added: str
    source_url: str
    score: float


class FinmaSearchResult(TypedDict, total=False):
    query: str
    matches: list[FinmaSearchMatch]
    warnings: list[FinmaSearchWarning]
    match_count: int


class EntityHistoryCurrent(TypedDict):
    name: str | None
    licence_type: str | None
    status: str | None
    canton: str | None
    city: str | None
    is_warning_listed: bool | None


class EntityHistoryEvent(TypedDict):
    event: str
    field: str
    old_value: str | None
    new_value: str | None
    recorded_at: int
    version: str


class EntityHistoryResult(TypedDict):
    uid: str
    current: EntityHistoryCurrent
    timeline: list[EntityHistoryEvent]
    versions_observed: list[str]
    source_note: str


# -- MCP wire ---------------------------------------------------------------


class JsonRpcError(TypedDict, total=False):
    code: int
    message: str
    data: object


class JsonRpcResponse(TypedDict, total=False):
    jsonrpc: Literal["2.0"]
    id: int | str | None
    result: object
    error: JsonRpcError


class ToolCallResultText(TypedDict):
    type: Literal["text"]
    text: str


class ToolCallResult(TypedDict, total=False):
    content: list[ToolCallResultText]
    isError: bool
    structured: object
