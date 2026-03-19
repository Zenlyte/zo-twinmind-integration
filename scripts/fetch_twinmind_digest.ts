#!/usr/bin/env bun
/**
 * Fetch TwinMind Daily Brief email and save to backup
 * 
 * Usage:
 *   bun fetch_twinmind_digest.ts [date]  # Date in YYYY-MM-DD format, defaults to yesterday MST
 */

const BACKUP_BASE = "/home/workspace/Data/Backups/TwinMind";

// Get date argument or default to yesterday in MST
function getTargetDate(): string {
  const args = process.argv.slice(2);
  const dateArg = args[0];

  let runDate: string;
  if (dateArg) {
    runDate = dateArg;
  } else {
    // Get yesterday's date in local timezone
    const now = new Date();
    const localDate = new Date(now.toLocaleString("en-US"));
    localDate.setDate(localDate.getDate() - 1); // Yesterday
    runDate = localDate.toISOString().split("T")[0];
  }
  return runDate;
}

async function fetchGmailDigest(date: string): Promise<{ subject: string; body: string; from: string } | null> {
  // Use Gmail API via Zo's existing integration
  // Search for TwinMind Daily Brief for the specific date
  const searchQuery = `from:twinmind "Daily Brief" "${date}"`;
  
  // We'll use the Zo API to search Gmail
  const response = await fetch("https://api.zo.computer/zo/ask", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.ZO_CLIENT_IDENTITY_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: `Search Gmail for: "${searchQuery}". If found, get the full email content including the HTML body. Return the email subject, from address, and full HTML body as JSON with keys: subject, from, body.`,
      model_name: "byok:<your-model-id-here>",
    }),
  });

  const data = await response.json() as any;
  const output = data.output;
  
  // Try to parse the output as JSON
  try {
    // Look for JSON in the output
    const jsonMatch = output.match(/\{[\s\S]*"subject"[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error("Could not parse email data");
  }
  
  return null;
}

async function main() {
  const date = getTargetDate();
  console.error(`Fetching TwinMind Daily Brief for ${date}...`);
  
  const email = await fetchGmailDigest(date);
  
  if (!email) {
    console.log(`No TwinMind Daily Brief found for ${date}`);
    process.exit(0);
  }
  
  // Save to backup directory
  const backupDir = `${BACKUP_BASE}/${date}`;
  const { mkdirSync, writeFileSync, existsSync } = await import("fs");
  
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
  }
  
  // Save as HTML file
  const digestPath = `${backupDir}/TwinMind_Daily_Brief.html`;
  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${email.subject}</title>
</head>
<body>
  <h1>${email.subject}</h1>
  <p><strong>From:</strong> ${email.from}</p>
  <hr>
  ${email.body}
</body>
</html>`;
  
  writeFileSync(digestPath, htmlContent);
  console.log(`Saved TwinMind Daily Brief to ${digestPath}`);
}

main().catch(console.error);