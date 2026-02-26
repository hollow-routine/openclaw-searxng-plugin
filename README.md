# openclaw-searxng-plugin

Minimal OpenClaw plugin for self-hosted SearXNG search.

## Included files
- `index.ts` (plugin tools logic)
- `openclaw.plugin.json` (plugin manifest + config schema)
- `package.json` (OpenClaw extension entry)

## Install
```bash
openclaw plugins install https://github.com/hollow-routine/openclaw-searxng-plugin.git
openclaw plugins enable openclaw-searxng-plugin
openclaw gateway restart
```

## Config example
```json
{
  "plugins": {
    "entries": {
      "openclaw-searxng-plugin": {
        "enabled": true,
        "config": {
          "baseUrl": "http://localhost:8888",
          "maxResults": 10,
          "language": "en",
          "safesearch": 0,
          "timeout": 15
        }
      }
    }
  }
}
```
