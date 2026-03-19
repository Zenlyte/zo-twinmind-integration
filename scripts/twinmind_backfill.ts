#!/usr/bin/env bun
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";

const TOKEN_FILE = "/home/workspace/.secrets/twinmind_token.json";
const CLIENT_ID = "mcp-client-qoy8xxYPyku_nYGkYiulrg";
const TOKEN_ENDPOINT = "https://api.thirdear.live/oauth/token";
const MCP_ENDPOINT = "https://api.twinmind.com/mcp";

interface TokenStore {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  client_id: string;
}

function loadTokens(): TokenStore {
  if (!existsSync(TOKEN_FILE)) throw new Error(`Missing token file: ${TOKEN_FILE}`);
  return JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));
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
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  const updated: TokenStore = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || current.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    client_id: current.client_id || CLIENT_ID,
  };
  saveTokens(updated);
  return updated;
}

async function ensureValidToken(): Promise<string> {
  const t = loadTokens();
  const now = Math.floor(Date.now() / 1000);
  if (t.expires_at && t.expires_at - now > 300) return t.access_token;
  return (await refreshToken()).access_token;
}

async function mcpCall(name: string, args: Record<string, any> = {}) {
  const token = await ensureValidToken();
  const body = {
    jsonrpc: "2.0",
    method: "tools/call",
    params: { name, arguments: args },
    id: 1,
  };

  const call = async (bearer: string) => {
    const resp = await fetch(MCP_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify(body),
    });
    return (await resp.json()) as any;
  };

  let data = await call(token);
  if (data.error?.code === -32001) {
    const refreshed = await refreshToken();
    data = await call(refreshed.access_token);
  }
  if (data.error) throw new Error(`MCP error: ${JSON.stringify(data.error)}`);
  return data.result;
}

function parseTextPayload(result: any): any {
  if (!result?.content) return null;
  const texts = result.content.filter((x: any) => x.type === "text").map((x: any) => x.text);
  if (!texts.length) return null;
  const joined = texts.join("\n");
  try {
    return JSON.parse(joined);
  } catch {
    const first = texts[0];
    return JSON.parse(first);
  }
}

function dayRange(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  const start = new Date(startISO + "T00:00:00Z");
  const end = new Date(endISO + "T00:00:00Z");
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function safeTitle(s: string) {
  return (s || "Untitled").replace(/[^a-zA-Z0-9]/g, "_").slice(0, 50);
}

async function fetchMeetingsForDay(day: string): Promise<any[]> {
  const start_time = `${day}T00:00:00`;
  const end_time = `${day}T23:59:59`;
  const result = await mcpCall("summary_search", { start_time, end_time, limit: 200 });
  const parsed = parseTextPayload(result);
  if (!Array.isArray(parsed)) return [];
  return parsed;
}

function writeDayArtifacts(dayDir: string, rows: any[]) {
  mkdirSync(`${dayDir}/summaries`, { recursive: true });
  mkdirSync(`${dayDir}/transcripts`, { recursive: true });

  const allActions = rows.flatMap((r) => r.actions);

  const digest = `# TwinMind Backup Digest (${rows[0]?.day || "Unknown"})\n\n**Total Meetings:** ${rows.length}\n**Summaries Saved:** ${rows.length}\n**Transcripts Saved:** ${rows.length}\n\n---\n\n## Meetings\n\n${rows.map((m: any, i: number) => `${i + 1}. **${m.title}**\n   - Date: ${m.day}\n   - Duration: ${m.duration}\n   - Summary: [summaries/${m.fileStem}.md](./summaries/${m.fileStem}.md)\n   - Transcript: [transcripts/${m.fileStem}.md](./transcripts/${m.fileStem}.md)`).join("\n\n")}\n\n---\n\n## Aggregated Action Items (${allActions.length})\n\n${allActions.length ? allActions.map((a: string) => `- ${a}`).join("\n") : "No action items found."}\n`;
  writeFileSync(`${dayDir}/digest.md`, digest);

  const index = `# TwinMind Backup Index\n\n- [Daily Digest](./digest.md)\n\n## Files\n\n- Summaries folder: [summaries/](./summaries)\n- Transcripts folder: [transcripts/](./transcripts)\n\n## Meeting Index\n\n${rows.map((m: any) => `- **${m.day}** ${m.title}\n  - [Summary](./summaries/${m.fileStem}.md)\n  - [Transcript](./transcripts/${m.fileStem}.md)`).join("\n")}`;
  writeFileSync(`${dayDir}/INDEX.md`, index);
}

async function main() {
  const args = process.argv.slice(2);
  const start = args[0] || "2020-01-01";
  const end = args[1] || new Date().toISOString().slice(0, 10);

  const days = dayRange(start, end);
  const seen = new Set<string>();
  let totalSaved = 0;

  for (const day of days) {
    let meetings: any[] = [];
    try {
      meetings = await fetchMeetingsForDay(day);
    } catch {
      continue;
    }
    if (!meetings.length) continue;

    const dayDir = `/home/workspace/Data/Backups/TwinMind/${day}`;
    mkdirSync(dayDir, { recursive: true });
    mkdirSync(`${dayDir}/summaries`, { recursive: true });
    mkdirSync(`${dayDir}/transcripts`, { recursive: true });

    const rows: any[] = [];

    for (const meeting of meetings) {
      const rawId = meeting.summary_id || meeting.meeting_id || "";
      if (!rawId) continue;
      const id = rawId.startsWith("summary-") ? rawId : `summary-${rawId}`;
      if (seen.has(id)) continue;
      seen.add(id);

      let full: any = {};
      try {
        const r = await mcpCall("fetch", { id });
        const parsed = parseTextPayload(r);
        full = parsed || {};
      } catch {
        full = { error: "fetch_failed" };
      }

      const meetingId = id.replace("summary-", "");
      const title = meeting.meeting_title || meeting.title || full.meeting_title || full.title || "Untitled";
      const titleSafeStr = safeTitle(title);
      const contentDay = (meeting.start_time_local || "").split("T")[0] || day;
      const stem = `${contentDay}_${titleSafeStr}_${meetingId.slice(0, 8)}`;
      const duration = meeting.start_time_local && meeting.end_time_local
        ? `${Math.round((new Date(meeting.end_time_local).getTime() - new Date(meeting.start_time_local).getTime()) / 60000)} minutes`
        : "Unknown";
      const actions = typeof meeting.action === "string"
        ? meeting.action.split("\n").map((x: string) => x.trim()).filter((x: string) => x)
        : [];

      const transcript = full.transcript || full.content || full.raw_text || "No transcript available.";

      const meta = {
        summary_id: meeting.summary_id || null,
        meeting_id: meeting.meeting_id || meetingId,
        meeting_title: meeting.meeting_title || meeting.title || null,
        start_time_local: meeting.start_time_local || null,
        end_time_local: meeting.end_time_local || null,
        current_location: meeting.current_location || null,
        relevance_score: meeting.relevance_score ?? null,
        fetch_id: full.id || id,
        fetch_type: full.type || null,
      };

      const summaryMd = `# ${title}\n\n**Meeting ID:** ${meetingId}\n**Date:** ${meeting.start_time_local || "Unknown"}\n**End Date:** ${meeting.end_time_local || "Unknown"}\n**Duration:** ${duration}\n\n---\n\n## Summary\n\n${meeting.summary || "No summary available."}\n\n---\n\n## Action Items\n\n${meeting.action || "No action items."}\n\n---\n\n## Raw Metadata\n\n\`\`\`json\n${JSON.stringify(meta, null, 2)}\n\`\`\`\n`;

      const transcriptMd = `# Transcript: ${title}\n\n**Meeting ID:** ${meetingId}\n**Date:** ${meeting.start_time_local || "Unknown"}\n\n---\n\n## Transcript\n\n${transcript}\n`;

      writeFileSync(`${dayDir}/summaries/${stem}.md`, summaryMd);
      writeFileSync(`${dayDir}/transcripts/${stem}.md`, transcriptMd);

      rows.push({
        id: meetingId,
        day: contentDay,
        title,
        duration,
        fileStem: stem,
        actions,
      });
      totalSaved += 1;
    }

    if (rows.length) {
      writeDayArtifacts(dayDir, rows);
      console.log(`Saved ${rows.length} meetings for ${day}`);
    }
  }

  console.log(`Backfill complete. Total meetings saved: ${totalSaved}`);
}

main();