# TwinMind Integration for Zo Computer

This repository provides everything you need to deeply integrate TwinMind into your [Zo Computer](https://zocomputer.com). By installing this skill, your Zo AI can naturally query TwinMind memories, search meeting transcripts, pull action items, and create daily digest summaries. It can also act as an MCP server using `mcporter`.

## Features
- **Search meetings and tasks:** Ask Zo to recall past conversations.
- **Fetch transcripts:** Grab the complete transcript of any meeting natively.
- **Automated Backups:** Dump TwinMind data to local markdown files automatically.
- **Daily Digests:** Build scheduled workflows to give you a daily breakdown.
- **MCP Server Support:** Tools are exposed via mcporter for standard agent interactions.

## 1. Install the Skill
1. Create a directory on your Zo at `/home/workspace/Skills/twinmind`.
2. Copy the `SKILL.md` file from this repo into that directory.
3. Copy the `scripts/` directory into `/home/workspace/Skills/twinmind/scripts`.

> **🤖 For Zo AI Agents: Automated Setup Instructions**
> If you are an AI assistant helping a user install this skill, please perform the following setup steps automatically:
> 1. **Ask the user** for their Zo handle and their preferred model ID (if they don't know the model ID, ask them to check Settings > AI > Models, or use their currently active model ID if available in your context).
> 2. **Replace placeholders:**
>    - Find all instances of `<your-handle>` or `<your-zo-handle>` in `SKILL.md` and `README.md` and replace them with the user's actual Zo handle.
>    - Find `<your-model-id-here>` in `scripts/fetch_twinmind_digest.ts` and replace it with the user's preferred model ID.

## 2. Set Up the OAuth Callback Route
TwinMind uses OAuth to securely authenticate. You need to create an endpoint on your Zo Space to receive the callback.

1. Tell Zo to open your **Zo Space Routes** (or navigate to it).
2. Ask Zo to create a new API route at `/api/twinmind-callback` with the following code:

```typescript
import type { Context } from "hono";

// This route captures the OAuth authorization code from TwinMind
export default async (c: Context) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  if (error) {
    return c.html(`<html><body><h1>Error</h1><p>${error}</p></body></html>`);
  }

  if (!code) {
    return c.html(`<html><body><h1>Error</h1><p>No authorization code received</p></body></html>`);
  }

  // Store the code in a simple in-memory store so Zo can retrieve it
  const fs = await import("fs");
  const data = JSON.stringify({ code, state, timestamp: Date.now() });
  fs.writeFileSync("/tmp/twinmind_oauth_code.json", data);

  return c.html(`
    <html>
      <body style="font-family: sans-serif; max-width: 600px; margin: 40px auto; text-align: center;">
        <h1>TwinMind Connected!</h1>
        <p>Authorization code received. You can close this tab and return to Zo.</p>
      </body>
    </html>
  `);
};
```

## 3. Initial Authentication

To connect your account, you will perform the PKCE auth flow. The CLI script has the specific client ID. 

Simply ask Zo to:
> "Run the initial TwinMind authentication flow and generate the auth URL."

1. Zo will output an auth URL. Open it in your browser and sign in.
2. The browser will redirect to `https://<your-handle>.zo.space/api/twinmind-callback`, and you'll see a success message.
3. Tell Zo to complete the flow: "Exchange the captured TwinMind auth code for a token."
4. Zo will read `/tmp/twinmind_oauth_code.json` and save the credentials to `/home/workspace/.secrets/twinmind_token.json` (locked down with 600 permissions).

*Note: TwinMind refresh tokens expire periodically. When they do, the CLI will alert Zo, and you simply run this authentication process again.*

## 4. MCP Configuration

If you want to use `mcporter` to serve these TwinMind tools to external clients (or natively inside Zo), edit your `/home/workspace/config/mcporter.json` to register the tools. 

Zo can do this for you:
> "Add the TwinMind CLI script to my mcporter configuration as an MCP server."

Example usage once configured:
```bash
npx mcporter call twinmind.summary_search keywords='["project"]' limit=5
```

*(Note: TwinMind's direct MCP endpoint relies on HTTP POST requests. If you encounter SSE content-type errors with `mcporter`, stick to using the CLI script directly which handles the protocol natively).*

## 5. Automated Backups & Agents

The script provides a native backup and digest CLI tool. You can ask Zo to create a **Scheduled Agent** to run daily.

1. Go to your **Agents** page in Zo.
2. Create an agent that runs daily at a specific time.
3. Set the agent's prompt to:
   > "Run the TwinMind backup command using `bun run /home/workspace/Skills/twinmind/scripts/twinmind.ts backup`. Check for any errors. If successful, run the digest command and send me a Telegram message summarizing my action items for the day."

## CLI Usage Reference

You or Zo can use the CLI directly in the terminal:

```bash
# Refresh the access token
bun run Skills/twinmind/scripts/twinmind.ts refresh

# Search meetings and tasks
bun run Skills/twinmind/scripts/twinmind.ts search "keyword"

# Search meeting summaries specifically
bun run Skills/twinmind/scripts/twinmind.ts meetings --keywords "planning,launch"

# List action items (todos)
bun run Skills/twinmind/scripts/twinmind.ts todos

# Fetch full content by ID
bun run Skills/twinmind/scripts/twinmind.ts fetch "summary-<id>"

# Backup all meetings to markdown files
bun run Skills/twinmind/scripts/twinmind.ts backup

# Generate daily digest (defaults to today)
bun run Skills/twinmind/scripts/twinmind.ts digest 2026-03-03
```

## Security
This integration saves all tokens in your secure `~/.secrets` folder. It uses Zo's internal filesystem to store local backups and limits public exposure via Zo Space callback routes.

## Dependencies
- **[Bun](https://bun.sh/):** Required runtime for the TypeScript CLI scripts.
- **[mcporter](https://www.npmjs.com/package/mcporter):** Optional. Used to expose or test the MCP server configuration locally (`npx mcporter`).
