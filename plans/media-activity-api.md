# Media Activity API

The Media Activity API exposes a read-only view of recent active playback for desktop widgets, dashboards, and compatibility adapters.

## Authentication

Requests must include either:

- `MEDIA_ACTIVITY_API_KEY` using `X-Media-Activity-Token`, `X-API-Key`, `token`, or `apiKey`
- an existing `WEBHOOK_ID` using `X-Webhook-ID` or `webhookId`

## Endpoints

### `GET /api/media-activity`

Returns a universal JSON summary of active playback sessions: every session that is live by the presence contract ([media-activity-presence.md](./media-activity-presence.md)), in the order the sessions started. A playing session's position is projected to the time of the request.

Query parameters:

- `limit`: max sessions returned. Defaults to `10`; maximum is `10` to match the desktop skin layout.

`activeWindowSeconds` was removed on 2026-11-08, from both the query and the response: each presence row now carries its own expiry, so there is no window left for a caller to tune.

### `GET /api/media-activity/xml/status/sessions`

Returns compatibility XML for skins or tools that already parse a `/status/sessions` shape.

### `GET /api/media-activity/xml/transcode/sessions`

Returns compatibility XML with the current transcode count. NextJS Stream playback does not currently expose transcoding sessions, so this returns `size="0"`.

### `GET /api/media-activity/xml/metadata/[id]`

Returns compatibility XML for one active session, by its row id.

## Desktop Skin Variables

The included desktop skin points its existing XML parser at the compatibility adapter:

```ini
MediaActivityAppAddress=http://127.0.0.1:3232
MediaActivityAddress=#MediaActivityAppAddress#/api/media-activity/xml
MediaActivityToken=CHANGE_ME_TO_WEBHOOK_ID_OR_MEDIA_ACTIVITY_API_KEY
```