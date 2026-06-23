#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== j-Lite Setup ==="
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js is not installed."
  echo "Please install Node.js (v18+) from https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node -v)
echo "Found Node.js $NODE_VERSION"

# Check for npm
if ! command -v npm &> /dev/null; then
  echo "ERROR: npm is not installed."
  exit 1
fi

echo "Found npm $(npm -v)"
echo ""

# Create .env from template if it doesn't exist
if [ ! -f .env ]; then
  echo "Creating .env file from template..."
  cp .env.example .env
  echo ""
  echo "** IMPORTANT: Edit .env with your JIRA credentials before running the app **"
  echo "   JIRA_BASE_URL  = Your Atlassian instance URL (e.g., https://yourteam.atlassian.net)"
  echo "   JIRA_EMAIL     = Your Atlassian account email"
  echo "   JIRA_API_TOKEN = Generate at https://id.atlassian.com/manage-profile/security/api-tokens"
  echo ""
else
  echo ".env file already exists, skipping."
fi

# Install root dependencies
echo "Installing server dependencies..."
npm install

# Install client dependencies
echo "Installing client dependencies..."
npm install --prefix client

# Build client
echo "Building client..."
npm run build

# Discover JIRA team/account IDs if not yet populated
if grep -qE '^(JIRA_TEAM_FIELD_ID|JIRA_TEAM_ID|JIRA_ACCOUNT_ID)=$' .env 2>/dev/null; then
  echo ""
  echo "Discovering JIRA Team/Account IDs..."
  npm run mcp:discover || echo "** Discovery failed; run 'npm run mcp:discover' manually after fixing .env. **"
fi

# Register the create-ticket MCP with Claude Code (user scope)
if command -v claude &> /dev/null; then
  echo ""
  echo "Registering create-jira-ticket MCP with Claude Code..."
  npm run mcp:install || echo "** MCP registration failed; run 'npm run mcp:install' manually later. **"
else
  echo ""
  echo "** 'claude' not found on PATH — skipping MCP registration. **"
  echo "   Run 'npm run mcp:install' after Claude Code is installed."
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "To start the app:"
echo "  Production:   npm start         (http://localhost:3000)"
echo "  Development:  npm run dev        (http://localhost:5173)"
echo ""
if [ ! -s .env ] || grep -q "your-" .env 2>/dev/null; then
  echo "** Don't forget to update .env with your JIRA credentials! **"
fi
