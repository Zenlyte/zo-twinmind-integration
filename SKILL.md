---
name: twinmind
description: Query TwinMind memories, meeting summaries, transcripts, and action items via MCP. Use when the user asks about past meetings, conversations, recorded notes, or TwinMind data.
category: Data & Integrations
metadata:
  author: curtastrophe.zo.computer
  emoji: 🧠
  emojis: ["🧠", "🎙️", "📝"]
tags:
  - twinmind
  - meetings
  - memory
  - transcription
  - mcp
---

# TwinMind MCP Integration

Query your TwinMind meeting memories, summaries, transcripts, and action items.

## Available Tools (via mcporter)

| Tool | Description |
|------|-------------|
| `summary_search` | Search meeting notes and summaries. Supports keywords, time filters, and semantic query. |
| `todo_search` | Fetch tasks and action items from review and main todo lists. |
| `search` | Search across all meetings and tasks. Returns IDs for use with `fetch`. |
| `fetch` | Get full content (transcript, details) by meeting or todo ID. |

## Usage via mcporter

```bash
# Search meetings
npx mcporter call twinmind.summary_search keywords='["badminton","EDBA"]' limit=5

# Search everything
npx mcporter call twinmind.search query="project discussion"

# Get todos
npx mcporter call twinmind.todo_search limit=20

# Fetch full transcript
npx mcporter call twinmind.fetch id="summary-<meeting_id>"
```

## Usage via CLI script

```bash
bun run Skills/twinmind/scripts/twinmind.ts search "badminton club"
bun run Skills/twinmind/scripts/twinmind.ts meetings --keywords "EDBA,shuttle"
bun run Skills/twinmind/scripts/twinmind.ts todos
bun run Skills/twinmind/scripts/twinmind.ts fetch "summary-<id>"
bun run Skills/twinmind/scripts/twinmind.ts backup   # Backup all meetings to markdown
bun run Skills/twinmind/scripts/twinmind.ts digest 2026-03-03  # Generate daily digest
bun run Skills/twinmind/scripts/twinmind.ts refresh   # refresh access token
```

### Backup Command

The `backup` command saves all TwinMind meetings to markdown files:
- Creates a date-stamped folder at `/home/workspace/Data/Backups/TwinMind/YYYY-MM-DD/`
- Each meeting saved as a separate markdown file with summary, action items, and transcript
- Generates an `INDEX.md` with links to all meetings
- Handles truncated responses gracefully (saves partial content)

### Digest Command

The `digest` command generates a daily summary:
- Aggregates all meetings for a specific date
- Extracts and lists all action items
- Shows total meeting count and duration
- Defaults to today's date if no date specified

## Token Management

- **Token file**: `/home/workspace/.secrets/twinmind_token.json` (mode 600)
- Contains both access token (1 hour expiry) and refresh token (~30 days)
- TwinMind rotates refresh tokens on every use - the CLI automatically persists the new token
- The CLI auto-refreshes the access token at 80% of expiry
- mcporter config at `/home/workspace/config/mcporter.json` is updated with each new access token
- OAuth client ID: `mcp-client-qoy8xxYPyku_nYGkYiulrg`
- OAuth callback route: `https://curtastrophe.zo.space/api/twinmind-callback`

## Re-authentication

If the refresh token expires (~30 days without use), re-authenticate:
1. Generate a new PKCE auth URL using the client ID above and the callback redirect URI
2. Open the auth URL in a browser, sign in with Google/Apple
3. The callback at `https://curtastrophe.zo.space/api/twinmind-callback` captures the authorization code to `/tmp/twinmind_oauth_code.json`
4. Exchange the code for tokens and save to `/home/workspace/.secrets/twinmind_token.json`
