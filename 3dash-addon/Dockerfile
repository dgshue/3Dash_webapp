ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.20

# Stage 1: Build the SPA from the dgshue fork's `dev` branch — that's the
# one tracking the Phase 0-7 anchor/calibration work. Override via build
# args (REPO_URL / REPO_REF) if you want to pin to a tag or test a PR.
FROM node:20-alpine AS builder

ARG BUILD_VERSION
ARG REPO_URL=https://github.com/dgshue/3Dash_webapp.git
ARG REPO_REF=dev
RUN apk add --no-cache git
WORKDIR /app
RUN git clone --depth 1 --branch ${REPO_REF} ${REPO_URL} .
RUN npm ci
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npm run build -- --mode addon

# Stage 2: Serve with nginx on HA base image (supervisor-friendly).
FROM ${BUILD_FROM}

RUN apk add --no-cache nginx

COPY --from=builder /app/dist /var/www/html
COPY nginx.conf /etc/nginx/http.d/default.conf
COPY run.sh /etc/services.d/nginx/run
RUN chmod +x /etc/services.d/nginx/run
