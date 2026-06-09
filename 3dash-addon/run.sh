#!/usr/bin/with-contenv bashio

# Serve the SPA, relay the HA WebSocket (Supervisor token), and persist
# config to /data. SUPERVISOR_TOKEN is provided because config.yaml sets
# homeassistant_api: true.
exec node /opt/3dash/server.js
