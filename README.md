# Reg-Starter

A local tool to start, stop, and monitor development apps from the browser. No login — configuration is saved on your machine.

## Quick start

```bash
cd path/to/reg-starter
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000)

On first run, the **setup wizard** opens automatically. Choose a template, import JSON, or build your app list manually. After saving, use the dashboard to control your local services.

Set a different port with the `PORT` environment variable (default: `3000`).

## First-run setup

1. Run `npm start` and open the URL shown in the terminal.
2. Pick how to configure:
   - **Template** — download a starter JSON file, edit paths on your machine, then import it
   - **Import JSON** — upload or paste a config file
   - **Manual** — add apps with name, folder path, command, and optional port
3. Review warnings (e.g. paths that do not exist yet) and save.
4. The dashboard opens — start, stop, and monitor apps from there.

To change config later, click **Settings** in the dashboard or edit the saved file directly.

## Where config is stored

Config is saved outside the project folder:

| Platform | Location |
|----------|----------|
| Windows | `%APPDATA%\Reg-Starter\apps.json` |
| macOS | `~/Library/Application Support/Reg-Starter/apps.json` |
| Linux | `~/.config/reg-starter/apps.json` |

Override the path with the `REG_STARTER_CONFIG` environment variable (full path to a JSON file).

## Features

- First-run setup wizard (templates, JSON import, manual builder)
- Start / Stop / Restart individual apps
- Start All / Stop All
- Live terminal output per app in the dashboard
- Folder browser for picking app paths during setup
- Export config as JSON from Settings
- Reload config without restarting the dashboard
- Detect externally started processes by port

## Configuration schema

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
    }
  ]
}
```

### Dashboard fields

| Field | Description |
|-------|-------------|
| `title` | Page title and header shown in the UI |
| `subtitle` | Tagline below the title |
| `logPrefix` | Prefix for dashboard log lines in the terminal panel |
| `configFile` | Config filename label (informational) |

### App fields

| Field | Description |
|-------|-------------|
| `id` | Unique key (auto-generated from name if omitted) |
| `name` | Display name shown on the card |
| `path` | Working directory where the app lives |
| `command` | Shell command to run (e.g. `npm start`) |
| `port` | Optional — used to detect external processes |

## Templates

Starter templates live in [`templates/`](templates/). Available in the setup wizard:

- **Minimal** — single app
- **Multi-service** — API + web client
- **Example stack** — several services with placeholder paths

Download a template, replace paths with your local folders, then import it in setup.

After editing the saved config file, click **Reload Config** in the dashboard.

## Notes

- Apps run as child processes managed by the dashboard (not separate terminal windows).
- Output streams into the dashboard terminal panel — click an app card to view its logs.
- Stopping an app kills the full process tree on Windows.
- Press `Ctrl+C` in the dashboard terminal to shut down and stop all running apps.
- **Reset setup** in Settings deletes your saved config and returns you to the wizard.
