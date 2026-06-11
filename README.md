# Reg Starter

A local dashboard to start, stop, and monitor your Reg Plus development apps from the browser.

## Quick start

```bash
cd H:\Reg-Starter
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000)

## Features

- Start / Stop / Restart individual apps
- Start All / Stop All
- Live terminal output per app in the dashboard
- JSON-configurable app list (`apps.json`)
- Reload config without restarting the dashboard

## Configure apps

Edit `apps.json` to add, remove, or change apps:

```json
{
  "apps": [
    {
      "id": "my-app",
      "name": "My App",
      "path": "H:\\cloud\\regplus\\myapp",
      "command": "npm start -- --port 8506",
      "port": 8506
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `id` | Unique key used by the dashboard |
| `name` | Display name shown on the card |
| `path` | Folder where the app lives |
| `command` | Shell command to run (usually `npm start`) |
| `port` | Optional — shown on the card for reference |

After editing `apps.json`, click **Reload Config** in the dashboard.

## Notes

- Apps run as child processes managed by Reg Starter (not separate Windows Terminal windows).
- Output streams into the dashboard terminal panel — click an app card to view its logs.
- Stopping an app kills the full process tree on Windows.
- Press `Ctrl+C` in the Reg Starter terminal to shut down the dashboard and stop all running apps.
