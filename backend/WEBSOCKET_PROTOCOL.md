# Sit-Sync WebSocket protocol (`sit-sync.v1`)

Connect to the same origin as the HTTP API. Messages are UTF-8 JSON objects and
must be smaller than `WS_MAX_MESSAGE_BYTES`.

1. Authenticate immediately after connecting:
   - Browser: `{"type":"auth","token":"<JWT>"}`
   - Mobile app: log in at `POST /api/auth/login`, then call authenticated
     `POST /api/auth/device/enroll` with its stable `device_id`. Send the
     returned device JWT as `{"type":"auth","token":"<JWT>"}`.
   - Pre-provisioned device: exchange its credential at `POST /api/auth/device`, then send
     `{"type":"auth","token":"<short-lived JWT>"}`. Direct credential auth is
     retained for provisioning diagnostics.
2. After `auth_ok`, send `{"type":"hello","role":"client"}` for a browser/mobile
   viewer or `{"type":"hello","role":"device"}` for a sensor.
3. A viewer subscribes with
   `{"type":"subscribe","device_ids":["device-01"]}`. An omitted `device_ids`
   subscribes to all devices owned by that user.
4. A device sends `{"type":"telemetry","payload":{...}}`. The payload
   `device_id` and `user_id` must match the authenticated device owner. Authorized subscribers
   receive `{"type":"telemetry","payload":{...enriched telemetry...}}`.

Enriched telemetry includes `metrics.forecast_model_variant`, whose value is
`rula` or `combined_strict`. The server sends that per-user choice to the ML
forecast endpoint and retains the model variant returned by the endpoint.

Authorized subscribers can also receive alert lifecycle messages:

```json
{
  "type": "alert",
  "payload": {
    "device_id": "device-01",
    "event": "triggered",
    "level": "ELEVATED",
    "source": "forecast",
    "observed_at_ms": 1720000000000,
    "forecast_generated_at_ms": 1719999999000
  }
}
```

`event` is `triggered`, `escalated`, or `resolved`; `level` is `ELEVATED` or
`HIGH`; and `source` is `detected` or `forecast`. Detected warning/critical
posture takes priority over forecasts. Forecast alerts require the configured
number of distinct forecast generations (default 2, selected from the final
validation replay). Active episodes are
deduplicated, resolution starts the configured cooldown (default 300 seconds),
and escalation to `HIGH` bypasses cooldown.

The server is authoritative for synthetic posture metrics. It computes
`metrics.cva_angle` as
`clamp(55 - abs(neck_back_pitch) * 0.7 - abs(trunk_pitch) * 0.2, 20, 60)`.
The combined `metrics.status` is the worse of estimated-RULA severity and CVA
severity. For a user's `warningCvaThreshold` (default `50`), CVA is `good` at or
above the threshold, `warning` below the threshold down to and including 10
degrees below it, and `critical` below that range.

Stored incident replays include `cva_angle` on every frame. Analytics history
returns nullable `avg_cva` per day and nullable `average_cva` in its summary;
event and replay-event metadata return nullable `minimum_cva_angle` for
backward compatibility with incidents recorded before CVA persistence.

Application heartbeats use `{"type":"ping"}` / `{"type":"pong"}`. The server
also uses WebSocket ping frames and terminates stale connections.

Every request may include `request_id`; acknowledgements and errors echo it.
Errors use:

```json
{"type":"error","code":"INVALID_PAYLOAD","message":"Invalid telemetry payload","request_id":"42"}
```

Device database credentials are stored as `sha256:<hex>` in
`devices.credential_hash`. Generate one with:

```sh
printf %s 'your-secret' | shasum -a 256
```

Apply migrations through `008_forecast_alert_preferences.sql` for an existing
database.
