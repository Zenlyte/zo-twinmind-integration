#!/usr/bin/env bun
/**
 * TwinMind MCP CLI - Query TwinMind memories via Streamable HTTP MCP
 *
 * Tokens stored in /home/workspace/.secrets/twinmind_token.json
 * Auto-refreshes access token and persists rotated refresh tokens.
 *
 * Usage:
 *   bun run twinmind.ts refresh          - Refresh the access token
 *   bun run twinmind.ts search <query>   - Search meetings and tasks
 *   bun run twinmind.ts meetings [opts]  - Search meeting summaries
 *   bun run twinmind.ts todos            - List todos/action items
 *   bun run twinmind.ts fetch <id>       - Fetch full content by ID
 *   bun run twinmind.ts --help           - Show help
 */

import { readFileSync, writeFileSync, existsSync } from "fs";

const TOKEN_FILE = "/home/workspace/.secrets/twinmind_token.json";
const CLIENT_ID = "mcp-client-qoy8xxYPyku_nYGkYiulrg";
const TOKEN_ENDPOINT = "https://api.thirdear.live/oauth/token";
const MCP_ENDPOINT = "https://api.twinmind.com/mcp";

interface TokenStore {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix seconds
  client_id: string;
}

function loadTokens(): TokenStore {
  if (!existsSync(TOKEN_FILE)) {
    console.error(
      `No token file found at ${TOKEN_FILE}.\n` +
      `Run the TwinMind OAuth flow to authenticate.\n` +
      `See: Skills/twinmind/SKILL.md`
    );
    process.exit(1);
  }
  try {
    return JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));
  } catch (e) {
    console.error(`Failed to parse token file: ${e}`);
    process.exit(1);
  }
}

function saveTokens(tokens: TokenStore) {
  writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

async function refreshToken(): Promise<TokenStore> {
  const current = loadTokens();

  const resp = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: current.refresh_token,
      client_id: current.client_id || CLIENT_ID,
    }),
  });

  const data = (await resp.json()) as any;

  if (data.access_token) {
    const updated: TokenStore = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || current.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      client_id: current.client_id || CLIENT_ID,
    };
    saveTokens(updated);
    console.error("Token refreshed and saved.");
    return updated;
  } else {
    console.error("Token refresh failed:", JSON.stringify(data));
    process.exit(1);
  }
}

async function ensureValidToken(): Promise<string> {
  const tokens = loadTokens();
  const now = Math.floor(Date.now() / 1000);
  // Refresh if within 5 minutes of expiry
  if (tokens.expires_at && (tokens.expires_at - now) > 300) {
    return tokens.access_token;
  }
  const refreshed = await refreshToken();
  return refreshed.access_token;
}

async function mcpCall(method: string, params: Record<string, any> = {}): Promise<any> {
  const token = await ensureValidToken();

  const resp = await fetch(MCP_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: method, arguments: params },
      id: 1,
    }),
  });

  const data = (await resp.json()) as any;

  if (data.error) {
    if (resp.status === 401 || data.error?.code === -32001) {
      const refreshed = await refreshToken();
      const retry = await fetch(MCP_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${refreshed.access_token}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: method, arguments: params },
          id: 1,
        }),
      });
      return ((await retry.json()) as any).result;
    }
    console.error("MCP error:", JSON.stringify(data.error));
    process.exit(1);
  }

  return data.result;
}

function printResult(result: any) {
  if (result?.content) {
    for (const item of result.content) {
      if (item.type === "text") {
        console.log(item.text);
      }
    }
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

// CLI
const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "--help") {
  console.log(`TwinMind MCP CLI

Tokens stored in /home/workspace/.secrets/twinmind_token.json
Auto-refreshes and persists rotated refresh tokens.

Usage:
  bun run twinmind.ts refresh                    Refresh the access token
  bun run twinmind.ts search <query>             Search meetings and tasks
  bun run twinmind.ts meetings [--query <q>]     Search meeting summaries
                      [--keywords <k1,k2>]
                      [--start <ISO>] [--end <ISO>]
                      [--limit <n>]
  bun run twinmind.ts todos [--completed]        List todos/action items
  bun run twinmind.ts fetch <id>                 Fetch full content by ID
  bun run twinmind.ts backup                     Backup all meetings to markdown
  bun run twinmind.ts digest [date]              Generate daily digest (defaults to today)`);
  process.exit(0);
}

switch (command) {
  case "refresh": {
    await refreshToken();
    break;
  }
  case "search": {
    const query = args.slice(1).join(" ");
    if (!query) {
      console.error("Usage: twinmind.ts search <query>");
      process.exit(1);
    }
    const result = await mcpCall("search", { query });
    printResult(result);
    break;
  }
  case "meetings": {
    const params: Record<string, any> = {};
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--query" && args[i + 1]) params.query = args[++i];
      else if (args[i] === "--keywords" && args[i + 1]) params.keywords = args[++i].split(",");
      else if (args[i] === "--start" && args[i + 1]) params.start_time = args[++i];
      else if (args[i] === "--end" && args[i + 1]) params.end_time = args[++i];
      else if (args[i] === "--limit" && args[i + 1]) params.limit = parseInt(args[++i]);
    }
    const result = await mcpCall("summary_search", params);
    printResult(result);
    break;
  }
  case "todos": {
    const params: Record<string, any> = {};
    if (args.includes("--completed")) params.include_completed = true;
    if (args.includes("--deleted")) params.include_deleted = true;
    const result = await mcpCall("todo_search", params);
    printResult(result);
    break;
  }
  case "fetch": {
    const id = args[1];
    if (!id) {
      console.error("Usage: twinmind.ts fetch <id>");
      process.exit(1);
    }
    const result = await mcpCall("fetch", { id });
    printResult(result);
    break;
  }
  case "backup": {
    // Accept date parameter or default to yesterday in MST timezone
    const dateArg = args.find((arg, i) => args[i - 1] === "--date" || args[i - 1] === "-d");
    
    let runDate: string;
    if (dateArg) {
      runDate = dateArg;
    } else {
      // Get yesterday's date in MST/MDT timezone (America/Edmonton)
      const now = new Date();
      const mstDate = new Date(now.toLocaleString("en-US", { timeZone: "America/Edmonton" }));
      mstDate.setDate(mstDate.getDate() - 1); // Yesterday
      runDate = mstDate.toISOString().split("T")[0];
    }
    
    const backupDir = `/home/workspace/Data/Backups/TwinMind/${runDate}`;
    const { mkdirSync } = await import("fs");

    const summariesDir = `${backupDir}/summaries`;
    const transcriptsDir = `${backupDir}/transcripts`;
    mkdirSync(summariesDir, { recursive: true });
    mkdirSync(transcriptsDir, { recursive: true });

    console.error(`Backing up to ${backupDir}...`);

    const startTime = `${runDate}T00:00:00`;
    const endTime = `${runDate}T23:59:59`;
    const summaryResult = await mcpCall("summary_search", { start_time: startTime, end_time: endTime, limit: 200 });

    let meetings: any[] = [];
    if (summaryResult?.content) {
      for (const item of summaryResult.content) {
        if (item.type === "text") {
          try {
            const parsed = JSON.parse(item.text);
            if (Array.isArray(parsed)) meetings = parsed;
          } catch {
            console.error("Warning: Could not parse summary_search response for backup day");
          }
        }
      }
    }

    console.error(`Found ${meetings.length} meetings to backup`);

    const meetingRows: {
      id: string;
      date: string;
      title: string;
      duration: string;
      summaryFile: string;
      transcriptFile: string;
      actions: string[];
    }[] = [];

    let summaryCount = 0;
    let transcriptCount = 0;

    for (let i = 0; i < meetings.length; i++) {
      const meeting = meetings[i] || {};
      const rawId = meeting.summary_id || meeting.meeting_id || "";
      if (!rawId) continue;
      const id = rawId.startsWith("summary-") ? rawId : `summary-${rawId}`;

      console.error(`Fetching ${i + 1}/${meetings.length}: ${id}...`);

      const fullResult = await mcpCall("fetch", { id });
      let fullContent: any = {};
      if (fullResult?.content) {
        for (const item of fullResult.content) {
          if (item.type === "text") {
            try {
              fullContent = JSON.parse(item.text);
            } catch {
              console.error(`Warning: Truncated response for ${id}, saving partial content`);
              const text = item.text;
              fullContent = {
                raw_text: text,
                error: "Response was truncated",
              };
            }
          }
        }
      }

      const title = meeting.meeting_title || meeting.title || "Meeting Notes";
      const date = meeting.start_time_local?.split("T")[0] || runDate;
      const startLocal = meeting.start_time_local || "Unknown";
      const endLocal = meeting.end_time_local || "Unknown";
      const duration = meeting.start_time_local && meeting.end_time_local
        ? `${Math.round((new Date(meeting.end_time_local).getTime() - new Date(meeting.start_time_local).getTime()) / 60000)} minutes`
        : "Unknown";
      const summary = meeting.summary || "No summary available.";
      const transcript = fullContent.transcript || fullContent.content || fullContent.raw_text || "No transcript available.";

      const actions = typeof meeting.action === "string"
        ? meeting.action.split("\n").map((a: string) => a.trim()).filter((a: string) => a.length > 0)
        : [];

      const sanitizedTitle = title.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 50);
      const baseFileName = `${date}_${sanitizedTitle}_${id.replace("summary-", "").slice(0, 8)}`;

      const metadataForSummary = {
        summary_id: meeting.summary_id || null,
        meeting_id: meeting.meeting_id || id.replace("summary-", ""),
        meeting_title: meeting.meeting_title || meeting.title || null,
        start_time_local: meeting.start_time_local || null,
        end_time_local: meeting.end_time_local || null,
        current_location: meeting.current_location || null,
        relevance_score: meeting.relevance_score ?? null,
        fetch_id: fullContent.id || id,
        fetch_type: fullContent.type || null,
      };

      const summaryFileName = `${baseFileName}.md`;
      const summaryPath = `${summariesDir}/${summaryFileName}`;
      const summaryMd = `# ${title}

**Meeting ID:** ${id.replace("summary-", "")}
**Date:** ${startLocal}
**End Date:** ${endLocal}
**Duration:** ${duration}

---

## Summary

${summary}

---

## Action Items

${actions.length > 0 ? actions.map((a: string) => `- ${a}`).join("\n") : "No action items."}

---

## Raw Metadata

\`\`\`json
${JSON.stringify(metadataForSummary, null, 2)}
\`\`\`
`;
      writeFileSync(summaryPath, summaryMd);
      summaryCount++;

      const transcriptFileName = `${baseFileName}.md`;
      const transcriptPath = `${transcriptsDir}/${transcriptFileName}`;
      const transcriptMd = `# ${title} - Full Transcript

**Meeting ID:** ${id.replace("summary-", "")}
**Date:** ${startLocal}
**End Date:** ${endLocal}
**Duration:** ${duration}

---

${transcript}
`;
      writeFileSync(transcriptPath, transcriptMd);
      transcriptCount++;

      meetingRows.push({
        id: id.replace("summary-", ""),
        date,
        title,
        duration,
        summaryFile: `summaries/${summaryFileName}`,
        transcriptFile: `transcripts/${transcriptFileName}`,
        actions,
      });
    }

    const indexMd = `# TwinMind Backup Index

**Backup Date:** ${new Date().toISOString()}
**Total Meetings:** ${meetingRows.length}
**Summaries Saved:** ${summaryCount}
**Transcripts Saved:** ${transcriptCount}

---

## Meetings

${meetingRows.map(m => `### ${m.date}: ${m.title}
- **Duration:** ${m.duration}
- **Summary:** [View Summary](${m.summaryFile})
- **Transcript:** [View Transcript](${m.transcriptFile})
- **Action Items:** ${m.actions.length > 0 ? m.actions.length + " items" : "None"}
`).join("\n")}
`;
    writeFileSync(`${backupDir}/INDEX.md`, indexMd);
    
    console.log(`\nBackup complete!`);
    console.log(`- Summaries: ${summaryCount} saved to ${summariesDir}`);
    console.log(`- Transcripts: ${transcriptCount} saved to ${transcriptsDir}`);
    break;
  }
  case "digest": {
    const dateArg = args[1] || new Date().toISOString().split("T")[0];
    const startTime = `${dateArg}T00:00:00`;
    const endTime = `${dateArg}T23:59:59`;
    
    console.error(`Generating digest for ${dateArg}...`);
    
    // Fetch meetings for the specific date
    const result = await mcpCall("summary_search", { 
      start_time: startTime, 
      end_time: endTime,
      limit: 50 
    });
    let meetings: any[] = [];
    
    if (result?.content) {
      for (const item of result.content) {
        if (item.type === "text") {
          try {
            const parsed = JSON.parse(item.text);
            meetings = Array.isArray(parsed) ? parsed : [];
          } catch (e) {
            console.error("Warning: Could not parse meetings response");
          }
        }
      }
    }
    
    if (meetings.length === 0) {
      console.log(`No meetings found for ${dateArg}`);
      break;
    }
    
    // Aggregate action items
    const allActions: string[] = [];
    const meetingSummaries: { title: string; summary: string; duration: string }[] = [];
    
    for (const m of meetings) {
      if (m.action) {
        const actions = m.action.split("\n").filter((a: string) => a.trim().startsWith("- [ ]"));
        allActions.push(...actions);
      }
      const start = m.start_time_local ? new Date(m.start_time_local) : null;
      const end = m.end_time_local ? new Date(m.end_time_local) : null;
      const duration = start && end ? `${Math.round((end.getTime() - start.getTime()) / 60000)} min` : "Unknown";
      meetingSummaries.push({
        title: m.meeting_title || "Untitled",
        summary: (m.summary || "").slice(0, 200) + "...",
        duration
      });
    }
    
    const digest = `# TwinMind Daily Digest: ${dateArg}

**Total Meetings:** ${meetings.length}
**Total Duration:** ${meetingSummaries.reduce((acc, m) => acc + (parseInt(m.duration) || 0), 0)} minutes

---

## Meetings

${meetingSummaries.map((m, i) => `### ${i + 1}. ${m.title}
**Duration:** ${m.duration}

${m.summary}
`).join("\n")}

---

## All Action Items (${allActions.length})

${allActions.length > 0 ? allActions.join("\n") : "No action items found."}

---

*Generated by TwinMind CLI on ${new Date().toISOString()}*
`;
    
    console.log(digest);
    break;
  }
  default:
    console.error(`Unknown command: ${command}. Use --help for usage.`);
    process.exit(1);
}
