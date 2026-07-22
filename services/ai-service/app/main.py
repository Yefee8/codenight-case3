from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime
from time import perf_counter
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest

from app.config import get_settings
from app.database import AiRepository
from app.decision import decision_for, rank_candidates, reason_codes, risk_level_for
from app.envelope import ApiEnvelope
from app.ids import uuid7
from app.model import ModelBundle
from app.rabbit_worker import RabbitWorker
from app.schemas import CategoryMetric, MetricValue, ModelInfo, ScoreRequest, ScoreResponse
from app.security import StaffPrincipal, require_internal_token, require_staff

settings = get_settings()
model_bundle = ModelBundle(settings.model_artifact_path, settings.model_manifest_path)
repository = AiRepository(settings.database_url)
rabbit_worker = RabbitWorker(repository, settings.rabbitmq_url)
HTTP_REQUESTS = Counter(
    "fraudcell_ai_http_requests_total", "AI HTTP requests", ("method", "route", "status")
)
HTTP_DURATION = Histogram(
    "fraudcell_ai_http_request_duration_seconds", "AI HTTP request duration", ("method", "route")
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    worker_started = False
    model_bundle.load()
    if model_bundle.ready and model_bundle.manifest is not None:
        try:
            repository.register_model(model_bundle.manifest)
        except Exception as error:  # readiness remains fail-closed; no secret is logged
            repository.last_error = error.__class__.__name__
    else:
        repository.check()
    if repository.ready:
        rabbit_worker.start()
        worker_started = True
    try:
        yield
    finally:
        if worker_started:
            rabbit_worker.stop()


app = FastAPI(
    title="FraudCell AI Service",
    version="1.0.0",
    docs_url="/docs",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)


def request_id(request: Request) -> UUID:
    return request.state.request_id


@app.middleware("http")
async def request_context(request: Request, call_next):
    started = perf_counter()
    candidate = request.headers.get("X-Request-ID")
    try:
        identifier = UUID(candidate) if candidate else uuid4()
    except ValueError:
        identifier = uuid4()
    request.state.request_id = identifier
    response = await call_next(request)
    response.headers["X-Request-ID"] = str(identifier)
    response.headers["Cache-Control"] = "no-store"
    route_object = request.scope.get("route")
    route = getattr(route_object, "path", "unmatched")
    HTTP_REQUESTS.labels(request.method, route, str(response.status_code)).inc()
    HTTP_DURATION.labels(request.method, route).observe(perf_counter() - started)
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, error: RequestValidationError) -> JSONResponse:
    fields: dict[str, list[str]] = {}
    for item in error.errors():
        location = ".".join(str(part) for part in item["loc"] if part not in {"body", "query"})
        fields.setdefault(location or "request", []).append(str(item["msg"]))
    envelope = ApiEnvelope.fail("VALIDATION_ERROR", "İstek alanları geçersiz.", request_id(request))
    if envelope.error is not None:
        envelope.error.field_errors = fields
    return JSONResponse(status_code=422, content=envelope.model_dump(mode="json"))


@app.exception_handler(HTTPException)
async def http_error(request: Request, error: HTTPException) -> JSONResponse:
    code = {401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "RESOURCE_NOT_FOUND"}.get(
        error.status_code, "REQUEST_REJECTED"
    )
    envelope = ApiEnvelope.fail(code, str(error.detail), request_id(request))
    return JSONResponse(status_code=error.status_code, content=envelope.model_dump(mode="json"))


@app.exception_handler(Exception)
async def unhandled_error(request: Request, _: Exception) -> JSONResponse:
    envelope = ApiEnvelope.fail(
        "INTERNAL_ERROR", "İstek güvenli biçimde tamamlanamadı.", request_id(request)
    )
    return JSONResponse(status_code=500, content=envelope.model_dump(mode="json"))


@app.get("/health/live", response_model=ApiEnvelope[dict[str, str]])
def live(request: Request) -> ApiEnvelope[dict[str, str]]:
    return ApiEnvelope.ok({"status": "UP"}, request_id(request))


@app.get("/health/ready", response_model=ApiEnvelope[dict[str, str]])
def ready(request: Request) -> JSONResponse | ApiEnvelope[dict[str, str]]:
    database_ready = repository.check()
    if not model_bundle.ready or not database_ready:
        envelope = ApiEnvelope.fail("MODEL_NOT_READY", "Model doğrulanamadı.", request_id(request))
        return JSONResponse(status_code=503, content=envelope.model_dump(mode="json"))
    return ApiEnvelope.ok({"status": "UP"}, request_id(request))


@app.get("/internal/metrics", include_in_schema=False)
def prometheus_metrics(_: Annotated[None, Depends(require_internal_token)]) -> Response:
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.post("/internal/v1/score", response_model=ApiEnvelope[ScoreResponse])
def score(
    payload: ScoreRequest,
    request: Request,
    _: Annotated[None, Depends(require_internal_token)],
) -> ApiEnvelope[ScoreResponse]:
    if not model_bundle.ready or model_bundle.artifact is None:
        raise HTTPException(status_code=503, detail="model is not ready")
    values = payload.features.model_dump(mode="python")
    prediction = model_bundle.predict(values)
    try:
        ranked = rank_candidates(payload.candidates, prediction.fraud_type, payload.features.region)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    response = ScoreResponse(
        prediction_id=uuid7(),
        model_version=str(model_bundle.artifact["model_version"]),
        feature_schema_version=str(model_bundle.artifact["feature_schema_version"]),
        risk_score=prediction.risk_score,
        risk_level=risk_level_for(prediction.risk_score),
        decision=decision_for(prediction.risk_score),
        fraud_type=prediction.fraud_type,
        reason_codes=reason_codes(values),
        ranked_candidates=ranked,
    )
    if not repository.ready:
        raise HTTPException(status_code=503, detail="prediction store is not ready")
    try:
        repository.persist_prediction(payload, response, request_id(request))
    except Exception as error:
        repository.last_error = error.__class__.__name__
        raise HTTPException(status_code=503, detail="prediction could not be persisted") from error
    return ApiEnvelope.ok(response, request_id(request))


Staff = Annotated[StaffPrincipal, Depends(require_staff)]


@app.get("/api/v1/ai/model", response_model=ApiEnvelope[ModelInfo])
def model_info(request: Request, _: Staff) -> ApiEnvelope[ModelInfo]:
    if not model_bundle.ready or model_bundle.manifest is None:
        raise HTTPException(status_code=503, detail="model is not ready")
    manifest = model_bundle.manifest
    return ApiEnvelope.ok(
        ModelInfo(
            model_version=manifest["model_version"],
            feature_schema_version=manifest["feature_schema_version"],
            artifact_sha256=manifest["artifact_sha256"],
            dataset_sha256=manifest["dataset_sha256"],
            trained_at=datetime.fromisoformat(manifest["trained_at"]),
            ready=True,
        ),
        request_id(request),
    )


@app.get("/api/v1/ai/metrics", response_model=ApiEnvelope[list[MetricValue]])
def metrics(request: Request, _: Staff) -> ApiEnvelope[list[MetricValue]]:
    manifest = _manifest_or_503()
    sample_count = int(manifest["metrics"]["holdout_count"])
    values = [
        MetricValue(name=name, value=float(manifest["metrics"][name]), sample_count=sample_count)
        for name in ("risk_roc_auc", "risk_recall", "risk_pr_auc", "risk_brier", "type_macro_f1")
    ]
    online = _online_metrics_or_503()
    values.extend(
        MetricValue(
            name=f"online_{name}", value=float(online[name]), sample_count=online["sample_count"]
        )
        for name in ("risk_accuracy", "false_positive_rate", "type_accuracy")
    )
    return ApiEnvelope.ok(values, request_id(request))


@app.get("/api/v1/ai/metrics/categories", response_model=ApiEnvelope[list[CategoryMetric]])
def category_metrics(request: Request, _: Staff) -> ApiEnvelope[list[CategoryMetric]]:
    online = _online_metrics_or_503()
    if online["categories"]:
        return ApiEnvelope.ok(
            [CategoryMetric.model_validate(value) for value in online["categories"]],
            request_id(request),
        )
    manifest = _manifest_or_503()
    metrics_value: dict[str, Any] = manifest["metrics"]
    values = [
        CategoryMetric(
            category=category,
            recall=float(recall),
            precision=float(metrics_value["category_precision"][category]),
            sample_count=int(manifest["label_counts"][category]),
        )
        for category, recall in metrics_value["category_recall"].items()
    ]
    return ApiEnvelope.ok(values, request_id(request))


def _manifest_or_503() -> dict[str, Any]:
    if not model_bundle.ready or model_bundle.manifest is None:
        raise HTTPException(status_code=503, detail="model is not ready")
    return model_bundle.manifest


def _online_metrics_or_503() -> dict[str, Any]:
    try:
        return repository.online_metrics()
    except Exception as error:
        repository.last_error = error.__class__.__name__
        raise HTTPException(status_code=503, detail="online metrics store is not ready") from error
