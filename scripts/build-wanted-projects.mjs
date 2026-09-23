import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// The source Markdown is a user-provided snapshot. Keep it outside the public
// data bundle because its descriptions can contain test credentials or names.
const sourcePath = process.argv[2];
const checkOnly = process.argv.includes("--check");

if (!sourcePath) {
  console.error("Usage: node scripts/build-wanted-projects.mjs <source.md> [--check]");
  process.exit(2);
}

const outputPath = fileURLToPath(
  new URL("../data/wanted-ai-championship-2026.json", import.meta.url),
);
const source = readFileSync(sourcePath, "utf8");

function field(section, name) {
  const prefix = "- **" + name + ":** ";
  const line = section.split("\n").find((candidate) => candidate.startsWith(prefix));
  assert.ok(line, "Missing source field: " + name);
  return line.slice(prefix.length).trim();
}

function sanitizePublicText(value) {
  // Remove a credential-bearing suffix altogether, including any password
  // whose label is separated from an email by punctuation.
  const markers = [
    /※\s*(?:심사용|테스트|체험|데모)/i,
    /(?:심사용|테스트|체험|데모)\s*(?:계정|로그인|ID)\s*[:：]/i,
    /(?:\bID\b|아이디|사용자명)\s*[:：=]/i,
    /(?:비밀번호|패스워드|\bPW\b|password|passcode|API[\s_-]?key|secret|token)\s*[:：=]/i,
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    /\b\d{6}[- ]?[1-4]\d{6}\b/,
    /\b01[016789][-. ]?\d{3,4}[-. ]?\d{4}\b/,
    /\+82[-. ]?10[-. ]?\d{3,4}[-. ]?\d{4}\b/,
  ];

  let cutoff = value.length;
  for (const marker of markers) {
    const match = marker.exec(value);
    if (match) cutoff = Math.min(cutoff, match.index);
  }

  const withoutBackupLink = value
    .slice(0, cutoff)
    .replace(/\(?백업\s*링크\s*:\s*https?:\/\/[^\s)]*\)?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cutoff < value.length || withoutBackupLink !== value.trim()
    ? withoutBackupLink.replace(/[-–—|,:;\s]+$/u, "").trim()
    : withoutBackupLink;
}

function publicUrl(value, required = false) {
  if (value === "없음") {
    assert.equal(required, false, "Missing required URL");
    return null;
  }

  const url = new URL(value);
  assert.ok(["http:", "https:"].includes(url.protocol), "Unexpected URL protocol");
  // A local bind address is not a publicly usable demo and should not become
  // a link that sends a visitor's browser to their own machine.
  const hostname = url.hostname.toLowerCase();
  if (!required && (
    ["0.0.0.0", "127.0.0.1", "localhost", "[::1]"].includes(hostname) ||
    hostname.endsWith(".local") ||
    /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(hostname)
  )) {
    return null;
  }
  // Some submitted demo links contain invite/access codes and tracking data.
  // Preserve only public identifiers needed to open catalog/video entries.
  const originalSearch = new URLSearchParams(url.search);
  url.username = "";
  url.password = "";
  url.pathname = url.pathname.replace(
    /\/(?:invite|access|token|secret|api-key)\/[^/]+.*$/i,
    "/",
  );
  url.search = "";
  url.hash = "";
  if (url.hostname === "www.youtube.com" && url.pathname === "/watch") {
    const videoId = originalSearch.get("v");
    if (videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      url.searchParams.set("v", videoId);
    }
  }
  if (url.hostname === "play.google.com" && url.pathname === "/store/apps/details") {
    const packageId = originalSearch.get("id");
    if (packageId && /^[A-Za-z][A-Za-z0-9_.]+$/.test(packageId)) {
      url.searchParams.set("id", packageId);
    }
  }
  if (url.hostname === "marketplace.visualstudio.com" && url.pathname === "/items") {
    const itemName = originalSearch.get("itemName");
    if (itemName && /^[A-Za-z0-9._-]+$/.test(itemName)) {
      url.searchParams.set("itemName", itemName);
    }
  }
  return url.toString();
}

function summary(section) {
  const summarySection = section.split("### 요약\n")[1]?.split("### 상세 설명\n")[0];
  assert.ok(summarySection, "Missing summary section");
  const fence = String.fromCharCode(96).repeat(3);
  const open = summarySection.indexOf(fence + "text");
  const close = summarySection.indexOf(fence, open + fence.length + 4);
  assert.ok(open >= 0 && close > open, "Malformed summary block");
  return sanitizePublicText(
    summarySection.slice(open + fence.length + 4, close).trim(),
  );
}

const headingPattern = /^## (\d+)\. ([^\n]+)$/gm;
const headings = [...source.matchAll(headingPattern)];
assert.equal(headings.length, 1391, "Expected 1,391 source entries");

const projects = headings.map((heading, index) => {
  const section = source.slice(
    heading.index,
    headings[index + 1]?.index ?? source.length,
  );
  const id = Number(field(section, "과제 ID"));
  const votes = Number(field(section, "투표 수 / 순위 / 내 투표 여부").split(" / ")[0]);
  const participation = field(section, "참가 형태");
  const submittedAt = field(section, "제출 / 생성 / 수정").split(" / ")[0];
  const detailUrl = publicUrl(field(section, "상세 링크"), true);
  const title = sanitizePublicText(heading[2]);

  assert.ok(Number.isInteger(id) && id > 0, "Invalid project ID");
  assert.ok(Number.isInteger(votes) && votes >= 0, "Invalid vote count: " + id);
  assert.ok(["TEAM", "INDIVIDUAL"].includes(participation), "Invalid participation: " + id);
  assert.ok(!Number.isNaN(Date.parse(submittedAt)), "Invalid submission time: " + id);
  assert.equal(
    detailUrl,
    "https://event.wanted.co.kr/ai-championship/2026/projects/" + id,
    "Detail URL mismatch: " + id,
  );
  assert.ok(title, "Missing title: " + id);

  return {
    id,
    title,
    summary: summary(section),
    tags: field(section, "태그").split(", ").map((item) => item.trim()),
    tools: field(section, "사용 도구").split(", ").map((item) => item.trim()),
    participation,
    votes,
    submittedAt,
    detailUrl,
    serviceUrl: publicUrl(field(section, "서비스 URL")),
  };
});

const collectedAt = source.match(/^- 수집 시각: ([\d-]+) ([\d:]+) \(Asia\/Seoul\)$/m);
const sourceUrl = source.match(/^- 출처: (https:\/\/\S+)$/m);
assert.ok(collectedAt && sourceUrl, "Missing source provenance");

const data = {
  snapshotAt: collectedAt[1] + "T" + collectedAt[2] + "+09:00",
  sourceUrl: sourceUrl[1],
  projects,
};

const tagCounts = new Map();
for (const project of projects) {
  for (const tag of project.tags) {
    assert.ok(tag, "Empty tag: " + project.id);
    tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  assert.ok(project.tools.every(Boolean), "Empty tool: " + project.id);
  for (const text of [project.title, project.summary]) {
    assert.equal(
      sanitizePublicText(text),
      text,
      "Potential credential or contact data in project " + project.id,
    );
  }
  if (project.serviceUrl) {
    const url = new URL(project.serviceUrl);
    assert.equal(publicUrl(project.serviceUrl), project.serviceUrl);
    assert.equal(url.hash, "", "Service URL fragment leaked: " + project.id);
    assert.equal(url.username, "", "Service URL userinfo leaked: " + project.id);
  }
}

assert.equal(new Set(projects.map((project) => project.id)).size, 1391);
assert.equal(projects.reduce((sum, project) => sum + project.votes, 0), 12804);
assert.equal(projects.filter((project) => project.participation === "TEAM").length, 502);
assert.equal(tagCounts.size, 22);
assert.equal(tagCounts.get("업무생산성/협업"), 205);
assert.equal(tagCounts.get("교육/학습"), 150);

// One project per line keeps diffs reviewable without adding 25,000 lines of
// formatting to the repository for this fixed snapshot.
const serialized = [
  "{",
  '  "snapshotAt": ' + JSON.stringify(data.snapshotAt) + ",",
  '  "sourceUrl": ' + JSON.stringify(data.sourceUrl) + ",",
  '  "projects": [',
  projects.map((project) => "    " + JSON.stringify(project)).join(",\n"),
  "  ]",
  "}",
  "",
].join("\n");
if (checkOnly) {
  assert.equal(readFileSync(outputPath, "utf8"), serialized, "Data file is out of date");
} else {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, serialized);
}

console.log(
  (checkOnly ? "Verified" : "Generated") +
    ": " +
    projects.length +
    " projects, " +
    tagCounts.size +
    " tags, 12,804 snapshot votes",
);
