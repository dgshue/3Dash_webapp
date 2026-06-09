ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.20

# Stage 1: Build the SPA from the dgshue fork. REPO_REF defaults to main (the
# shipping branch); override (REPO_URL / REPO_REF) to pin a tag or test a PR.
FROM node:20-alpine AS builder

ARG BUILD_VERSION
ARG REPO_URL=https://github.com/dgshue/3Dash_webapp.git
ARG REPO_REF=main
RUN apk add --no-cache git
WORKDIR /app
RUN git clone --depth 1 --branch ${REPO_REF} ${REPO_URL} .
RUN npm ci
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npm run build -- --mode addon

# Stage 2: Run the Node ingress server (serves the SPA, relays the HA
# WebSocket with the Supervisor token, persists config to /data).
FROM ${BUILD_FROM}

RUN apk add --no-cache nodejs npm

# Built SPA
COPY --from=builder /app/dist /var/www/html

# Ingress server + its deps (installed at image-build time)
COPY server/ /opt/3dash/
WORKDIR /opt/3dash
RUN npm install --omit=dev --no-audit --no-fund

# s6 service
COPY run.sh /etc/services.d/3dash/run
RUN chmod +x /etc/services.d/3dash/run
