FROM node:22-bookworm-slim AS frontend-builder

WORKDIR /app/frontend/cleanLogic
COPY frontend/cleanLogic/package*.json ./
RUN npm ci
COPY frontend/cleanLogic/ ./
ARG VITE_GOOGLE_CLIENT_ID=191625527569-l6ereqd4ga4o4h5l4t5vr685nri9l2hj.apps.googleusercontent.com
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
RUN npm run build


FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEBUG=false \
    FRONTEND_DIST=/app/frontend_dist

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 graphviz \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
COPY --from=frontend-builder /app/frontend/cleanLogic/dist ./frontend_dist

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
