FROM python:3.13-slim-bookworm AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv

WORKDIR /build
ENV PATH="/opt/venv/bin:$PATH"

COPY pyproject.toml uv.lock ./
COPY app ./app
RUN pip install --upgrade pip "uv==0.6.8" \
    && uv sync --frozen --no-dev --no-editable

FROM python:3.13-slim-bookworm AS runtime

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000

RUN groupadd --gid 10001 fraudcell \
    && useradd --uid 10001 --gid fraudcell --no-create-home --shell /usr/sbin/nologin fraudcell

WORKDIR /app
COPY --from=builder /opt/venv /opt/venv
COPY --chown=fraudcell:fraudcell app ./app
COPY --chown=fraudcell:fraudcell alembic ./alembic
COPY --chown=fraudcell:fraudcell alembic.ini pyproject.toml uv.lock entrypoint.sh ./
RUN mkdir -p /app/model-artifacts /app/synthetic-data \
    && chown -R fraudcell:fraudcell /app \
    && chmod 0555 /app/entrypoint.sh

USER 10001:10001
EXPOSE 8000

ENTRYPOINT ["/bin/sh", "/app/entrypoint.sh"]
