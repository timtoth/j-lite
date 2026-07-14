# jLite

A two-pane JIRA dashboard. The left pane reads JIRA directly via REST; the right pane delegates write operations (creating/updating tickets) to the local [Claude Code](https://claude.com/claude-code) CLI via MCP.

## Installation

Grab the latest release from the [Releases page](https://github.com/timtoth/j-lite/releases/latest). Pick your platform below.

### Windows

#### Easy install

Open PowerShell and run:

```powershell
irm https://github.com/timtoth/j-lite/releases/latest/download/jLite-Setup.exe -OutFile "$env:TEMP\jLite-Setup.exe"; & "$env:TEMP\jLite-Setup.exe"
```

This downloads and launches the installer in one step. jLite installs silently to your user profile and starts automatically.

#### Manual install

1. Download `jLite-Setup.exe` from the [latest release](https://github.com/timtoth/j-lite/releases/latest).
2. Run the downloaded file. jLite installs and launches automatically — no dialogs.

### macOS

Only Apple Silicon (arm64) builds are currently published.

#### Easy install

Open Terminal and run:

```bash
curl -sL "$(curl -s https://api.github.com/repos/timtoth/j-lite/releases/latest | grep -o 'https://[^"]*arm64\.dmg')" -o /tmp/jLite.dmg && open /tmp/jLite.dmg
```

This resolves the current version's `.dmg` from the latest release, downloads it, and opens it in Finder; drag jLite into Applications to finish.

#### Manual install

1. Download `jLite-<version>-arm64.dmg` from the [latest release](https://github.com/timtoth/j-lite/releases/latest).
2. Open the `.dmg` and drag **jLite** into your **Applications** folder.
3. On first launch, macOS Gatekeeper may block the app since it isn't notarized — right-click **jLite.app** and choose **Open**, then confirm.

A plain `.zip` of the `.app` bundle (`jLite-darwin-arm64-<version>.zip`) is also available if you prefer not to mount a disk image.

### Linux

Builds are published as `.deb` (Debian/Ubuntu) and `.rpm` (Fedora/RHEL). Both install a `ticket-control` command and a "jLite" entry in your application menu.

#### Easy install

**Debian/Ubuntu:**

```bash
curl -sL -o /tmp/jlite.deb "$(curl -s https://api.github.com/repos/timtoth/j-lite/releases/latest | grep -o 'https://[^"]*_amd64\.deb')" && sudo apt install /tmp/jlite.deb
```

**Fedora/RHEL:**

```bash
sudo dnf install "$(curl -s https://api.github.com/repos/timtoth/j-lite/releases/latest | grep -o 'https://[^"]*\.x86_64\.rpm')"
```

Both commands resolve the current version's asset URL from the latest release, so there's no version number to keep up to date.

#### Manual install

**Debian/Ubuntu:**

1. Download `ticket-control_<version>_amd64.deb` from the [latest release](https://github.com/timtoth/j-lite/releases/latest).
2. Install it: `sudo apt install ./ticket-control_<version>_amd64.deb`

**Fedora/RHEL:**

1. Download `ticket-control-<version>-1.x86_64.rpm` from the [latest release](https://github.com/timtoth/j-lite/releases/latest).
2. Install it: `sudo dnf install ./ticket-control-<version>-1.x86_64.rpm`

## First-time setup

On first launch, jLite prompts you to configure your JIRA connection (base URL, email, API token). You'll need a [JIRA API token](https://id.atlassian.com/manage-profile/security/api-tokens) from your Atlassian account.

The right-pane write path shells out to the `claude` CLI, so [Claude Code](https://claude.com/claude-code) must be installed and authenticated separately.

## Development

See [CLAUDE.md](./CLAUDE.md) for architecture notes and development commands.
