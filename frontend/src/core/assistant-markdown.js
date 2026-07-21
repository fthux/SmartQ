const tableSeparatorPattern = /^:?-{3,}:?$/;
const inlinePattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g;

export function parseAssistantMarkdown(value = "") {
  const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }

    const codeFence = lines[index].trim().match(/^```([\w-]*)\s*$/);
    if (codeFence) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index].trim())) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", language: codeFence[1] || "", content: code.join("\n") });
      continue;
    }

    const table = parseTable(lines, index);
    if (table) {
      blocks.push(table.block);
      index = table.nextIndex;
      continue;
    }

    const heading = lines[index].match(/^\s{0,3}(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(lines[index])) {
      const quoteLines = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) quoteLines.push(lines[index++].replace(/^\s*>\s?/, ""));
      blocks.push({ type: "quote", lines: quoteLines });
      continue;
    }

    const listItem = parseListItem(lines[index]);
    if (listItem) {
      const items = [];
      const ordered = listItem.ordered;
      while (index < lines.length) {
        const item = parseListItem(lines[index]);
        if (!item || item.ordered !== ordered) break;
        items.push(item.text);
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim()) {
      if (paragraph.length && (parseTable(lines, index) || isBlockStart(lines[index]))) break;
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", lines: paragraph });
  }

  return blocks;
}

export function parseInlineMarkdown(value = "") {
  const text = String(value || "");
  const tokens = [];
  let cursor = 0;

  for (const match of text.matchAll(inlinePattern)) {
    const start = match.index || 0;
    if (start > cursor) tokens.push({ type: "text", text: text.slice(cursor, start) });
    const raw = match[0];
    if (raw.startsWith("`")) tokens.push({ type: "code", text: raw.slice(1, -1) });
    else if (raw.startsWith("**")) tokens.push({ type: "strong", text: raw.slice(2, -2) });
    else {
      const link = raw.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      tokens.push(link ? { type: "link", text: link[1], href: link[2] } : { type: "text", text: raw });
    }
    cursor = start + raw.length;
  }

  if (cursor < text.length) tokens.push({ type: "text", text: text.slice(cursor) });
  return tokens.length ? tokens : [{ type: "text", text }];
}

function parseTable(lines, index) {
  if (index + 1 >= lines.length) return null;
  const header = tableCells(lines[index]);
  const separator = tableCells(lines[index + 1]);
  if (!header || !separator || header.length !== separator.length || !separator.every((cell) => tableSeparatorPattern.test(cell))) return null;

  const rows = [];
  let nextIndex = index + 2;
  while (nextIndex < lines.length && lines[nextIndex].trim()) {
    const cells = tableCells(lines[nextIndex]);
    if (!cells) break;
    rows.push(Array.from({ length: header.length }, (_, cellIndex) => cells[cellIndex] || ""));
    nextIndex += 1;
  }

  return {
    block: {
      type: "table",
      header,
      aligns: separator.map((cell) => cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : "left"),
      rows,
    },
    nextIndex,
  };
}

function tableCells(value) {
  let line = String(value || "").trim();
  if (line.startsWith("**|") && line.endsWith("|**")) line = line.slice(2, -2).trim();
  if (!line.includes("|")) return null;
  if (line.startsWith("|")) line = line.slice(1);
  if (line.endsWith("|")) line = line.slice(0, -1);
  return line.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function parseListItem(value) {
  const match = String(value || "").match(/^\s*(?:(\d+)\.|[-+*])\s+(.+)$/);
  return match ? { ordered: Boolean(match[1]), text: match[2].trim() } : null;
}

function isBlockStart(value) {
  const line = String(value || "");
  return /^\s{0,3}#{1,4}\s+/.test(line) || /^\s*>\s?/.test(line) || Boolean(parseListItem(line)) || /^```/.test(line.trim());
}
