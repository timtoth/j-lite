# Ticket Control - Task Checklist

## Architecture
- **Ticket list (left column)**: Direct JIRA REST API calls (requires API token)
- **Operations (right column)**: Claude Code CLI with JIRA MCP passthrough

## Prerequisites
- [ ] Generate a JIRA API token from Atlassian account settings
- [ ] Have JIRA MCP server configured and connected to Claude Code

## Project Setup
- [ ] Initialize Node.js project (package.json)
- [ ] Install dependencies (Express, dotenv, node-fetch or built-in fetch for JIRA API)
- [ ] Create `.env` file for JIRA credentials (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN)
- [ ] Create `.gitignore` (node_modules, .env)

## Backend (Express Server)
- [ ] Set up Express server with basic routing and static file serving
- [ ] Create JIRA API module (authenticate via Basic Auth, fetch tickets assigned to current user)
- [ ] Create GET `/api/tickets` endpoint to return assigned tickets (id, title, status)
- [ ] Create POST `/api/instruct` endpoint that shells out to Claude Code CLI with the user's instruction
- [ ] Ensure Claude Code CLI invocation uses the JIRA MCP for ticket operations

## Frontend (Single Page)
- [ ] Create HTML page with two-column layout
- [ ] Left column: ticket list displaying ticket ID, title, and status for each assigned ticket
- [ ] Right column: text area for typing instructions + a submit button
- [ ] Add minimal CSS styling for a clean layout
- [ ] Add JS to fetch and render ticket list on page load
- [ ] Add JS to submit text area instructions to the backend and display the response

## Integration & Testing
- [ ] Verify JIRA connection and ticket fetching works with real credentials
- [ ] Verify Claude Code MCP passthrough executes JIRA operations (e.g., transition a ticket)
- [ ] Confirm page refresh re-fetches the latest ticket data from JIRA
- [ ] End-to-end test: move a ticket through statuses via the text area
