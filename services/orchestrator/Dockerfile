FROM python:3.12-slim AS base

# Microsoft ODBC Driver 18 for SQL Server.
# Pinned to msodbcsql18 (current GA) — Microsoft ships dpkg-named packages
# we install from the Ubuntu noble repo via the official MS apt source.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        curl gnupg ca-certificates unixodbc; \
    curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
      | gpg --dearmor -o /usr/share/keyrings/microsoft.gpg; \
    echo "deb [signed-by=/usr/share/keyrings/microsoft.gpg] https://packages.microsoft.com/debian/12/prod bookworm main" \
      > /etc/apt/sources.list.d/mssql-release.list; \
    apt-get update; \
    ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18; \
    rm -rf /var/lib/apt/lists/*

# Build deps for pyodbc; removed in a second layer to keep the image small.
FROM base AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc g++ unixodbc-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml /app/pyproject.toml
COPY lakebridge /app/lakebridge

RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir .

# Runtime image
FROM base
WORKDIR /app
COPY --from=builder /usr/local/lib/python3.12 /usr/local/lib/python3.12
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --from=builder /app /app
COPY ../../db /db

ENV LAKEBRIDGE_MIGRATIONS_DIR=/db/migrations \
    PYTHONUNBUFFERED=1

EXPOSE 8080

# Run migrations on container start, then serve. In production splitting
# these into separate jobs (k8s pre-install Job + Deployment) is cleaner.
CMD ["sh", "-c", "lakebridge-migrate up && lakebridge-serve"]
