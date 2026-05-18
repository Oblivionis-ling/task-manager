# task-manager

`task-manager` is a local Web Agent for turning messy thoughts into a practical task workbench.

The current `main` branch is agent-only. It no longer installs as a Codex Skill and no longer writes Obsidian Markdown. Older Codex Skill and Markdown-based versions are still available from GitHub Releases.

## What It Does

- Shows the most important actions for today on the first screen.
- Converts a brain dump into editable task drafts through an OpenAI-compatible model API.
- Saves confirmed tasks into a local JSON store under the project directory.
- Supports manual task creation, editing, and completion.
- Keeps recent history and store backups for recovery.

## Run Locally

Recommended:

```powershell
.\start-agent.cmd
```

Then open the URL printed by the script, usually:

```text
http://127.0.0.1:8787
```

To stop the agent:

```powershell
.\stop-agent.cmd
```

The `.cmd` wrappers run PowerShell with `ExecutionPolicy Bypass`, which avoids common local script policy issues on Windows.

You can also run the PowerShell scripts directly:

```powershell
.\start-agent.ps1
.\stop-agent.ps1
```

Low-level manual start:

```powershell
node server.js
```

Then open:

```text
http://127.0.0.1:8787
```

If the default port is busy, the server automatically tries the next available port up to `8899`.

## Data Storage

By default, data is stored inside the repository working directory:

```text
.task-manager-data/store.json
.task-manager-data/backups/
```

`.task-manager-data/` is ignored by git and should not be committed.

To store data elsewhere:

```powershell
.\start-agent.cmd -DataDir "D:\task-manager-data"
```

The server writes the store through a temporary file and rename flow. Before each update, it copies the previous `store.json` into `backups/`.

## Model Provider

The UI includes DeepSeek and OpenRouter presets, plus a custom OpenAI-compatible provider option.

API keys are not written to `store.json`. Provider settings entered in the browser are saved in browser `localStorage`; the server can also use provider key environment variables such as `DEEPSEEK_API_KEY` or `OPENROUTER_API_KEY`.

## API

- `GET /api/state`: returns tasks, today focus, drafts, history, settings, and data paths.
- `POST /api/drafts`: sends the brain dump to the configured model and creates an editable draft.
- `POST /api/drafts/:id/commit`: commits edited draft tasks into the local store.
- `POST /api/tasks`: creates a manual task.
- `PATCH /api/tasks/:id`: updates a task.
- `POST /api/tasks/:id/complete`: marks a task complete.

## Repository Layout

```text
server.js
start-agent.ps1
stop-agent.ps1
start-agent.cmd
stop-agent.cmd
public/
  index.html
  styles.css
  app.js
```

## Historical Codex Skill Releases

The old Skill/Markdown versions are no longer on `main`, but remain downloadable:

- [v0.3.0](https://github.com/Oblivionis-ling/task-manager/releases/tag/v0.3.0)
- [v0.2.0](https://github.com/Oblivionis-ling/task-manager/releases/tag/v0.2.0)
- [v0.1.2](https://github.com/Oblivionis-ling/task-manager/releases/tag/v0.1.2)
- [v0.1.1](https://github.com/Oblivionis-ling/task-manager/releases/tag/v0.1.1)
- [v0.1.0](https://github.com/Oblivionis-ling/task-manager/releases/tag/v0.1.0)

## License

MIT
