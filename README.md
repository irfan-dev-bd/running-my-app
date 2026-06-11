# App Dashboard

A config-driven local dashboard to start, stop, and monitor development apps from the browser. Define your apps and dashboard branding in a single JSON file — no code changes required.

## Quick start

```bash
cd path/to/app-dashboard
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000)

Set a different port with the `PORT` environment variable (default: `3000`).

## Features

- Start / Stop / Restart individual apps
- Start All / Stop All
- Live terminal output per app in the dashboard
- JSON-configurable app list and dashboard branding
- Reload config without restarting the dashboard
- Detect externally started processes by port

## Configuration

Edit `apps.json` to define the dashboard and the apps it manages:

```json
{
  "dashboard": {
    "title": "My Dev Stack",
    "subtitle": "Control local services from one place",
    "logPrefix": "launcher",
    "configFile": "apps.json"
  },
  "apps": [
    {
      "id": "api-server",
      "name": "API Server",
      "path": "C:\\projects\\my-api",
      "command": "npm start",
      "port": 4000
    },
    {
      "id": "web-client",
      "name": "Web Client",
      "path": "C:\\projects\\my-web",
      "command": "npm run dev -- --port 5173",
      "port": 5173
    }
  ]
}
```

### Dashboard fields

| Field | Description |
|-------|-------------|
| `title` | Page title and header shown in the UI |
| `subtitle` | Tagline below the title |
| `logPrefix` | Prefix for dashboard log lines in the terminal panel (e.g. `[launcher]`) |
| `configFile` | Config filename shown in the footer |

### App fields

| Field | Description |
|-------|-------------|
| `id` | Unique key used by the dashboard |
| `name` | Display name shown on the card |
| `path` | Working directory where the app lives |
| `command` | Shell command to run (e.g. `npm start`) |
| `port` | Optional — used to detect external processes and show on the card |

After editing `apps.json`, click **Reload Config** in the dashboard.

## Notes

- Apps run as child processes managed by the dashboard (not separate terminal windows).
- Output streams into the dashboard terminal panel — click an app card to view its logs.
- Stopping an app kills the full process tree on Windows.
- Press `Ctrl+C` in the dashboard terminal to shut down and stop all running apps.
