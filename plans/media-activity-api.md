# Media Activity API

The Media Activity API exposes a read-only view of recent active playback for desktop widgets, dashboards, and compatibility adapters.

## Authentication

Requests must include either:

- `MEDIA_ACTIVITY_API_KEY` using `X-Media-Activity-Token`, `X-API-Key`, `token`, or `apiKey`
- an existing `WEBHOOK_ID` using `X-Webhook-ID` or `webhookId`

## Endpoints

### `GET /api/media-activity`

Returns a universal JSON summary of active playback sessions.

Query parameters:

- `activeWindowSeconds`: how recently a playback heartbeat must have updated to count as active. Defaults to `15`; maximum is `300`.
- `limit`: max sessions returned. Defaults to `10`; maximum is `10` to match the desktop skin layout.

### `GET /api/media-activity/xml/status/sessions`

Returns compatibility XML for skins or tools that already parse a `/status/sessions` shape.

### `GET /api/media-activity/xml/transcode/sessions`

Returns compatibility XML with the current transcode count. NextJS Stream playback does not currently expose transcoding sessions, so this returns `size="0"`.

### `GET /api/media-activity/xml/metadata/[id]`

Returns compatibility XML for one active session from the active playback window.

## Desktop Skin Variables

The included desktop skin points its existing XML parser at the compatibility adapter:

```ini
MediaActivityAppAddress=http://127.0.0.1:3232
MediaActivityAddress=#MediaActivityAppAddress#/api/media-activity/xml
MediaActivityToken=CHANGE_ME_TO_WEBHOOK_ID_OR_MEDIA_ACTIVITY_API_KEY
```