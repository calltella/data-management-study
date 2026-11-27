import MarkdownIt from "markdown-it";

const explanationMarkdown = new MarkdownIt("default", {
  html: false,
  breaks: true,
  linkify: false,
});

explanationMarkdown.disable([
  "code",
  "fence",
  "blockquote",
  "hr",
  "lheading",
  "emphasis",
  "link",
  "autolink",
  "backticks",
  "strikethrough",
  "html_block",
  "html_inline",
  "reference",
]);

function escapeHtmlAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

explanationMarkdown.renderer.rules.image = (tokens, idx) => {
  const token = tokens[idx];
  const src = String(token?.attrGet("src") ?? "");
  if (!/^\/explanation-diagrams\/[a-zA-Z0-9_.-]+\.(?:svg|png|jpe?g|webp)$/u.test(src)) {
    return "";
  }
  const alt = token?.content ?? "";
  return `<img class="explanation-diagram-image" src="${escapeHtmlAttr(src)}" alt="${escapeHtmlAttr(alt)}" loading="lazy">`;
};

const isSpaceOrNewline = (ch: number) => ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d;

explanationMarkdown.inline.ruler.before("emphasis", "cjk_strong", (state, silent) => {
  const start = state.pos;
  const max = state.posMax;
  const src = state.src;

  if (start + 4 > max) return false;
  if (src.charCodeAt(start) !== 0x2a || src.charCodeAt(start + 1) !== 0x2a) return false;
  if (src.charCodeAt(start + 2) === 0x2a || isSpaceOrNewline(src.charCodeAt(start + 2))) return false;

  let closePos = -1;
  for (let i = start + 3; i < max - 1; i++) {
    if (src.charCodeAt(i) === 0x2a && src.charCodeAt(i + 1) === 0x2a) {
      if (!isSpaceOrNewline(src.charCodeAt(i - 1))) {
        closePos = i;
        break;
      }
    }
  }
  if (closePos === -1) return false;
  if (silent) {
    state.pos = closePos + 2;
    return true;
  }

  const openToken = state.push("strong_open", "strong", 1);
  openToken.markup = "**";

  const oldPosMax = state.posMax;
  state.pos = start + 2;
  state.posMax = closePos;
  state.md.inline.tokenize(state);
  state.posMax = oldPosMax;

  const closeToken = state.push("strong_close", "strong", -1);
  closeToken.markup = "**";

  state.pos = closePos + 2;
  return true;
});

const clampHeadingTag = (tag: string) => (tag === "h1" || tag === "h2" ? "h3" : tag);

explanationMarkdown.renderer.rules.heading_open = (tokens, idx, options, _env, self) => {
  tokens[idx].tag = clampHeadingTag(tokens[idx].tag);
  return self.renderToken(tokens, idx, options);
};

explanationMarkdown.renderer.rules.heading_close = (tokens, idx, options, _env, self) => {
  tokens[idx].tag = clampHeadingTag(tokens[idx].tag);
  return self.renderToken(tokens, idx, options);
};

export function breakSentences(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*(?:\||#)/.test(line)) return line;
      return line.replace(/(。)(\*{0,2})[^\S\r\n]*(?=[^」』）\s])/gu, (match, period: string, stars: string, offset: number) => {
        if (stars.length === 2) {
          const prefix = line.slice(0, offset);
          const isInsideStrong = ((prefix.match(/\*\*/g) ?? []).length % 2) === 1;
          return isInsideStrong ? `${period}${stars}\n` : `${period}\n${stars}`;
        }
        if (stars.length === 1) {
          return `${period}\n${stars}`;
        }
        return `${period}\n`;
      });
    })
    .join("\n");
}

export function renderExplanationMarkdown(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return explanationMarkdown.render(breakSentences(trimmed));
}
