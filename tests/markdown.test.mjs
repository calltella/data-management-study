import { test } from "node:test";
import assert from "node:assert/strict";
import { breakSentences, renderExplanationMarkdown } from "../src/client/markdown.ts";

test("解説Markdownで太字・リスト・表・見出しを変換できる", () => {
  const md = [
    "# 大見出し",
    "### 小見出し",
    "これは**重要**です。次の文です。",
    "",
    "- 項目A",
    "- 項目B",
    "",
    "1. 手順1",
    "2. 手順2",
    "",
    "| 項目 | 内容。補足 |",
    "|---|---|",
    "| A | 説明。詳細 |",
  ].join("\n");

  const html = renderExplanationMarkdown(md);
  assert.match(html, /<h3>大見出し<\/h3>/);
  assert.match(html, /<h3>小見出し<\/h3>/);
  assert.match(html, /<strong>重要<\/strong>です。<br>\n次の文です。/);
  assert.match(html, /<ul>\n<li>項目A<\/li>\n<li>項目B<\/li>\n<\/ul>/);
  assert.match(html, /<ol>\n<li>手順1<\/li>\n<li>手順2<\/li>\n<\/ol>/);
  assert.match(html, /<table>[\s\S]*<th>内容。補足<\/th>[\s\S]*<td>説明。詳細<\/td>[\s\S]*<\/table>/);
});

test("生HTML・リンク・斜体・インデントコードブロックは無効化される", () => {
  const md = [
    '<script>alert(1)</script>',
    '[リンク](https://example.com)とhttps://example.com',
    '*斜体テスト*と_アンダースコア_と1..*',
    '        ↑↓',
    '概念スキーマ',
  ].join("\n");

  const html = renderExplanationMarkdown(md);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<a\s/);
  assert.doesNotMatch(html, /<em>/);
  assert.doesNotMatch(html, /<pre>|<code>/);
  assert.match(html, /\*斜体テスト\*/);
  assert.match(html, /_アンダースコア_/);
  assert.match(html, /1\.\.\*/);
});

test("日本語の閉じ括弧直後の**太字**も正しく変換される", () => {
  const html = renderExplanationMarkdown(
    "管理する**データライフサイクル管理（DLM）**の考え方と、**最小限の範囲（対象・操作・期間）**の権限です。",
  );
  assert.doesNotMatch(html, /\*\*/);
  assert.match(html, /<strong>データライフサイクル管理（DLM）<\/strong>の考え方/);
  assert.match(html, /<strong>最小限の範囲（対象・操作・期間）<\/strong>の権限/);
});

test("breakSentencesは表行と見出し行を分割せず太字文末を維持する", () => {
  assert.equal(
    breakSentences("### タイトル。補足\n| A | B。C |\n**重要な文です。** 次の文です。"),
    "### タイトル。補足\n| A | B。C |\n**重要な文です。**\n次の文です。",
  );
  assert.match(
    renderExplanationMarkdown("**重要な文です。** 次の文です。"),
    /<strong>重要な文です。<\/strong><br>\n次の文です。/,
  );
  assert.equal(
    breakSentences("次元削減のアプローチです。**主成分分析**（PCA）は、"),
    "次元削減のアプローチです。\n**主成分分析**（PCA）は、",
  );
  assert.match(
    renderExplanationMarkdown("次元削減のアプローチです。**主成分分析**（PCA）は、"),
    /次元削減のアプローチです。<br>\n<strong>主成分分析<\/strong>（PCA）は、/,
  );
});
