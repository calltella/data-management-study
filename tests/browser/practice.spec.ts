import { test, expect } from "@playwright/test";
import { demoCategories, demoQuestions } from "../../src/demo";
import pastQuestions from "../../database/questions-2024.json" with { type: "json" };
import pastQuestions2023 from "../../database/questions-2023.json" with { type: "json" };
test.beforeEach(async ({ page }) => {
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: { configured: false, url: null, key: null } }),
  );
  await page.route("**/api/demo", (route) =>
    route.fulfill({
      json: { categories: demoCategories, questions: demoQuestions },
    }),
  );
});
test("起動中はサンプルモードの帯を隠して画面中央にスピナーを表示する", async ({ page }) => {
  const config = Promise.withResolvers<void>();
  await page.route("**/api/config", async (route) => {
    await config.promise;
    await route.fulfill({ json: { configured: false, url: null, key: null } });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const loading = page.locator(".startup-loading");
  try {
    await expect(page.getByRole("heading", { name: "学習の準備をしています…" })).toBeVisible();
    await expect(page.locator(".banner")).toHaveCount(0);
    await expect(loading).toHaveCSS("position", "fixed");
    await expect(loading).toHaveCSS("place-items", "center");
    const animation = await loading.evaluate((element) => getComputedStyle(element, "::before").animationName);
    expect(animation).toBe("answer-loading-spin");
  } finally {
    config.resolve();
  }
  await expect(page.getByRole("heading", { name: "おかえりなさい" })).toBeVisible();
  await expect(loading).toHaveCount(0);
  await expect(page.locator(".banner")).toContainText("サンプルモード");
});

test("ログイン案内・ゲスト回答・正答を先に見る・変更禁止", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "おかえりなさい" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "2027年度開始予定の新しい試験に向けて" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "ログインせずに始める" }).click();
  await page.getByRole("combobox", { name: "出題数" }).selectOption("0");
  await page.locator('input[name="category"][value="data"]').uncheck();
  await page.getByRole("checkbox", { name: "選択肢を並べ替える" }).check();
  await page.getByRole("button", { name: "最初から出題する", exact: true }).click();
  await page.getByRole("button", { name: "先に正答・解説を見る" }).click();
  await expect(page.locator(".explanation")).toBeVisible();
  await expect(page.getByRole("button", { name: /問題を編集|解説を編集/ })).toHaveCount(0);
  const choice = page.locator("[data-choice]").first();
  const text = page.locator("[data-eliminate]").first();
  await expect(choice).toBeEnabled();
  await text.click();
  await expect(text).toHaveAttribute("aria-pressed", "true");
  await expect(text).toHaveCSS("text-decoration-line", "line-through");
  await expect(choice).toBeDisabled();
  await text.press("Space");
  await expect(text).toHaveAttribute("aria-pressed", "false");
  await expect(choice).toBeEnabled();
  await page.locator("[data-choice]").first().click();
  await expect(page.locator("[data-choice]").first()).toBeDisabled();
  await expect(page.getByText("ゲストの回答は保存していません")).toBeVisible();
  const nextQuestion = page.getByRole("link", { name: "次の問題へ" });
  await expect(nextQuestion).toHaveCSS("font-size", "16px");
  await nextQuestion.click();
  await expect(page.getByRole("heading", { name: "問 2 ／ 2問" })).toBeVisible();
  await page.locator("[data-choice]").first().click();
  await page
    .getByRole("link", { name: "演習を終了", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: "演習が完了しました。" }),
  ).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage).length)).toBe(0);
  expect(errors).toEqual([]);
});
test("スマートフォン表示と問題不足の案内", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#practice");
  await page.getByRole("button", { name: "最初から出題する", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("条件に合う問題は3問");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "/tmp/dm-study-mobile.png", fullPage: true });
});

test("出題分類は最上位だけで配下の問題件数を表示する", async ({ page }) => {
  await page.goto("/#practice");
  await expect(page.locator('input[name="category"]')).toHaveCount(2);
  await expect(page.locator(".categories")).toContainText(
    "データマネジメント （1問）",
  );
  await expect(page.locator(".categories")).toContainText(
    "データベース （2問）",
  );
  await expect(
    page.getByRole("checkbox", { name: "品質の改善", exact: true }),
  ).toHaveCount(0);
});

test("分類は初期全選択で全解除と全選択を切り替えられる", async ({ page }) => {
  await page.goto("/#practice");
  await expect(page.locator('input[name="category"]:checked')).toHaveCount(2);
  await page.getByRole("combobox", { name: "出題数" }).selectOption("0");
  await page.getByRole("button", { name: "全解除", exact: true }).click();
  await expect(page.locator('input[name="category"]:checked')).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "出題数" })).toHaveValue("0");
  await page.getByRole("button", { name: "最初から出題する", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "分類を1つ以上選択してください",
  );
  await expect(page.locator('input[name="category"]:checked')).toHaveCount(0);
  await page.getByRole("button", { name: "全選択", exact: true }).click();
  await expect(page.locator('input[name="category"]:checked')).toHaveCount(2);
  await page.getByRole("button", { name: "最初から出題する", exact: true }).click();
  await expect(page.getByRole("heading", { name: "問 1 ／ 3問" })).toBeVisible();
});

test("出題数メニューと設定は分類枠内にあり全部を選べる", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#practice");
  await expect(
    page.getByRole("link", { name: "学習する", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".setup-heading")).toContainText("公開問題 3問");
  await expect(page.getByRole("button", { name: "全解除" })).toHaveCSS("font-size", "11px");
  const menu = page.locator('.categories select[name="count"]');
  await expect(menu).toHaveValue("10");
  await expect(menu.locator("option")).toHaveText([
    "10",
    "15",
    "20",
    "25",
    "30",
    "全部",
  ]);
  await expect(page.locator('.categories input[name="shuffle"]')).toHaveCount(
    1,
  );
  await menu.selectOption("0");
  await page.getByRole("button", { name: "最初から出題する", exact: true }).click();
  await expect(page.getByRole("heading", { name: "問 1 ／ 3問" })).toBeVisible();
  await expect(page.getByText(/指定は/)).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("回答の取得中は出題画面を保ち、結果が届いてから切り替える", async ({ page }) => {
  const q = demoQuestions[0];
  const response = Promise.withResolvers<void>();
  const requested = Promise.withResolvers<void>();
  let submissions = 0;
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: { configured: true, url: "https://example.supabase.co", key: "test-key" },
    }),
  );
  await page.route("**/api/rpc", async (route) => {
    const { name } = route.request().postDataJSON();
    if (name === "catalog")
      return route.fulfill({ json: { categories: demoCategories, questions: [q] } });
    submissions++;
    requested.resolve();
    await response.promise;
    await route.fulfill({ json: q });
  });

  await page.goto("/#practice");
  await page.getByRole("button", { name: "最初から出題する", exact: true }).click();
  const panel = await page.locator(".question").elementHandle();
  const choice = page.locator(`[data-choice="${(q.correct! % 4) + 1}"]`);
  await choice.click();
  await requested.promise;
  try {
    await choice.click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator(".explanation")).toHaveCount(0);
    expect(await panel!.evaluate((element) => element.isConnected)).toBe(true);
  } finally {
    response.resolve();
  }
  await expect(page.locator(".explanation")).toContainText("不正解です");
  await expect(page.locator(".explanation h2")).toHaveCSS("color", "rgb(132, 45, 37)");
  await expect(page.locator(".choice.correct")).toContainText("正解");
  await expect(page.locator(".choice.selected")).toContainText("誤答");
  for (const selector of [".choices", ".choice.correct", ".explanation", ".choice-explanations"]) {
    await expect(page.locator(selector)).toHaveCSS("background-color", "rgb(232, 241, 251)");
  }
  for (const label of await page.locator("[data-choice]").all()) {
    await expect(label).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(label).toHaveCSS("opacity", "1");
  }
  await expect(page.getByRole("group", { name: "過去の回答" })).toHaveCount(0);
  expect(submissions).toBe(1);
  await expect(page.locator(".question-body")).toHaveCSS("font-size", "13px");
  await expect(page.locator(".explanation p").first()).toHaveCSS("font-size", "13px");
});

for (const longChoices of [false, true]) {
  test(`出典の編集注記を省き、${longChoices ? "長い選択肢は1列" : "短い選択肢は2列"}で表示する`, async ({ page }) => {
    const pastQuestion = pastQuestions.find(({ id }) => id === "DMQ-0033")!;
    const question = {
      ...pastQuestion,
      category_id: demoQuestions[0].category_id,
      choices: longChoices ? pastQuestion.choices : pastQuestion.choices.map(({ id }) => ({ id, body: `選択肢${id}` })),
    };
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.route("**/api/demo", (route) =>
      route.fulfill({ json: { categories: demoCategories, questions: [question] } }),
    );
    await page.goto("/#practice");
    await page.getByRole("button", { name: "最初から出題する", exact: true }).click();
    await expect(page.locator(".question-source")).toHaveText(
      "令和6年度 秋期 データベーススペシャリスト試験 午前Ⅱ 問20",
    );
    const rows = await page.locator("[data-choice]").evaluateAll((choices) =>
      choices.map((choice) => choice.getBoundingClientRect().top),
    );
    expect(new Set(rows).size).toBe(longChoices ? 4 : 2);
    await expect(page.locator("[data-choice]").first()).toBeEnabled();
  });
}

test("解説では並べ替え後の記号と選択肢本文に個別解説が対応する", async ({ page }) => {
  const question = {
    ...pastQuestions.find(({ id }) => id === "DMQ-0023")!,
    category_id: demoQuestions[0].category_id,
  };
  await page.route("**/api/demo", (route) =>
    route.fulfill({ json: { categories: demoCategories, questions: [question] } }),
  );
  await page.goto("/#practice");
  await page.getByRole("checkbox", { name: "選択肢を並べ替える" }).check();
  await page.getByRole("button", { name: "最初から出題する", exact: true }).click();
  await expect(page.locator(".choice-explanation")).toHaveCount(0);
  const correctLabel = await page.locator('[data-choice="4"]').innerText();
  await page.getByRole("button", { name: "先に正答・解説を見る" }).click();
  await expect(page.locator(".choice-explanation")).toHaveCount(4);
  const correctDetail = page.locator(".choice-explanation").filter({
    hasText: question.choices[3].body,
  });
  await expect(correctDetail.locator(".choice-explanation-label")).toHaveText(correctLabel);
  await expect(correctDetail.locator(".choice-explanation-result")).toHaveText("正解");
  await expect(correctDetail.locator(".choice-explanation-label")).toHaveCSS("color", "rgb(34, 88, 62)");
  await expect(correctDetail.locator(".choice-explanation-detail")).toContainText("公開と再利用を日常の業務に組み込む");
});

test("親和図の問題は解説に4種類の図を表示する", async ({ page }) => {
  const question = {
    ...pastQuestions.find(({ id }) => id === "DMQ-0029")!,
    category_id: demoQuestions[0].category_id,
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/demo", (route) =>
    route.fulfill({ json: { categories: demoCategories, questions: [question] } }),
  );
  await page.goto("/#practice");
  await page.getByRole("button", { name: "最初から出題する", exact: true }).click();
  await expect(page.locator(".choice-explanation-figure")).toHaveCount(0);
  await page.getByRole("button", { name: "先に正答・解説を見る" }).click();

  const figures = page.locator(".choice-explanation-figure");
  await expect(figures.locator("figcaption")).toHaveText([
    "特性要因図の例", "親和図の例", "マトリックス図の例", "ヒストグラムの例",
  ]);
  for (const image of await figures.getByRole("img").all()) {
    expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("再構成の注記を出典見出しから移し、パンくずから出題条件へ戻れる", async ({ page }) => {
  const question = {
    ...demoQuestions[0],
    source: "出典：令和5年度 秋期 データベーススペシャリスト試験 午前Ⅱ 問2（問題文・選択肢を再構成）",
  };
  await page.route("**/api/demo", (route) =>
    route.fulfill({ json: { categories: demoCategories, questions: [question] } }),
  );
  await page.goto("/#practice");
  await page.getByRole("button", { name: "最初から出題する" }).click();
  await expect(page.locator(".question-source")).toHaveText(
    "令和5年度 秋期 データベーススペシャリスト試験 午前Ⅱ 問2",
  );
  await page.getByRole("button", { name: "先に正答・解説を見る" }).click();
  await expect(page.locator(".explanation")).toContainText("問題文・選択肢を再構成");
  await expect(page.getByRole("button", { name: "出題条件へ戻る" })).toHaveCount(0);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("navigation", { name: "パンくず" }).getByRole("link", { name: "出題条件" }).click();
  await expect(page.getByRole("button", { name: "最初から出題する" })).toBeVisible();
});

test("科目Aとの関連度を言葉で表示し、根拠を確認できる", async ({ page }) => {
  const question = {
    ...pastQuestions2023.find(({ id }) => id === "DMQ-0043")!,
    category_id: demoQuestions[0].category_id,
  };
  await page.route("**/api/demo", (route) =>
    route.fulfill({ json: { categories: demoCategories, questions: [question] } }),
  );
  await page.goto("/#practice");
  await page.getByRole("button", { name: "最初から出題する" }).click();
  const assessment = page.locator(".question-likelihood");
  await expect(assessment.locator("summary")).toHaveText("科目Aとの関連度（AI評価）｜間接的に関連");
  await expect(assessment.locator("p")).toBeHidden();
  const collapsed = (await assessment.boundingBox())!;
  await assessment.locator("summary").press("Enter");
  await expect(assessment.locator("p")).toContainText("決定木と期待値");
  await expect(assessment.locator("p")).toBeVisible();
  const expanded = (await assessment.boundingBox())!;
  expect(expanded.width).toBe(collapsed.width);
  expect(expanded.x).toBe(collapsed.x);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("問題文を文の区切りで改行して表示する", async ({ page }) => {
  const question = {
    ...demoQuestions[0],
    body: "資料を参照する。適切な対応を選ぶ。",
  };
  await page.route("**/api/demo", (route) =>
    route.fulfill({ json: { categories: demoCategories, questions: [question] } }),
  );
  await page.goto("/#practice");
  await page.getByRole("button", { name: "最初から出題する" }).click();
  const body = page.locator(".question-body");
  await expect(body).toHaveCSS("white-space", "pre-wrap");
  expect(await body.textContent()).toContain("資料を参照する。\n適切な対応を選ぶ。");
});

test("問題の種類を複数選んでゲスト演習を始められる", async ({ page }) => {
  await page.route("**/api/demo", (route) => route.fulfill({
    json: {
      categories: demoCategories,
      questions: demoQuestions.map((question, index) => ({
        ...question,
        origin: ["ai_original", "ipa_past", "ipa_sample"][index],
      })),
    },
  }));
  await page.goto("/#practice");
  const ai = page.getByRole("checkbox", { name: "AIオリジナル問題" });
  const past = page.getByRole("checkbox", { name: "IPA過去問" });
  const sample = page.getByRole("checkbox", { name: "IPA公式サンプル" });
  const start = page.getByRole("button", { name: "最初から出題する", exact: true });
  await expect(ai).toBeChecked();
  await expect(past).toBeChecked();
  await expect(sample).toBeChecked();
  const dbCount = page.locator('[data-category-count="db"]');
  const dataCount = page.locator('[data-category-count="data"]');
  await expect(dbCount).toHaveText("（2問）");
  await expect(dataCount).toHaveText("（1問）");
  await ai.uncheck();
  await expect(dbCount).toHaveText("（1問）");
  await past.uncheck();
  await sample.uncheck();
  await expect(dbCount).toHaveText("（0問）");
  await expect(dataCount).toHaveText("（0問）");
  await start.click();
  await expect(page.getByRole("status")).toContainText("問題の種類を1つ以上選択してください");
  await past.check();
  await sample.check();
  await expect(dbCount).toHaveText("（1問）");
  await expect(dataCount).toHaveText("（1問）");
  await start.click();
  await expect(page.getByRole("heading", { name: "問 1 ／ 2問" })).toBeVisible();
  const bodies = [];
  for (let i = 0; i < 2; i++) {
    bodies.push(await page.locator(".question-body").innerText());
    await page.locator("[data-choice]").first().click();
    if (i === 0) await page.getByRole("link", { name: "次の問題へ" }).click();
  }
  const compact = (text: string) => text.replace(/\s/g, "");
  expect(bodies.map(compact).sort()).toEqual(demoQuestions.slice(1).map(q => compact(q.body)).sort());
});

test("鉛筆モードで選んだ語句に下線を引き、回答後に個別に消せる", async ({ page }) => {
  await page.goto("/#practice");
  await page.getByRole("button", { name: "最初から出題する" }).click();
  const body = page.locator(".question-body");
  const pencil = page.locator(".question-heading").getByRole("button", { name: "下線", exact: true });
  await expect(pencil).toHaveText("✎");
  await expect(pencil).toHaveCSS("color", "rgb(102, 94, 82)");
  const marks = body.locator(".question-underline");
  const drag = async (from: number, to: number) => {
    const [start, end] = await body.evaluate((element, offsets) => {
      return offsets.map((offset) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const size = node.textContent!.length;
          if (offset <= size) {
            const range = document.createRange();
            range.setStart(node, offset);
            range.collapse(true);
            const rect = range.getBoundingClientRect();
            return { x: rect.x, y: rect.y + rect.height / 2 };
          }
          offset -= size;
        }
        throw new Error("指定位置の文字がありません");
      });
    }, [from, to]);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();
  };
  await page.evaluate(() => document.fonts.ready);
  const original = (await body.textContent())!;
  await drag(1, 4);
  await expect(marks).toHaveCount(0);
  await pencil.click();
  await expect(pencil).toHaveCSS("color", "rgb(163, 77, 83)");
  await expect(page.locator(".underline-apply")).toBeHidden();
  await drag(1, 4);
  await expect(marks).toHaveText([original.slice(1, 4)]);
  await expect(marks.first()).toHaveCSS("text-decoration-color", "rgb(163, 77, 83)");
  await drag(8, 12);
  await expect(marks).toHaveText([original.slice(1, 4), original.slice(8, 12)]);
  await pencil.click();
  await page.locator("[data-choice]").first().click();
  await expect(marks).toHaveCount(2);
  await marks.first().click();
  await expect(marks).toHaveText([original.slice(8, 12)]);
  await expect(body).toHaveText(original);
  await page.getByRole("link", { name: "次の問題へ" }).click();
  await expect(marks).toHaveCount(0);
  await expect(pencil).toHaveAttribute("aria-pressed", "false");
});

test.describe("タッチでの下線", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test("選択範囲を調整して確定し、タップで消せる", async ({ page }) => {
    await page.goto("/#practice");
    await page.getByRole("button", { name: "最初から出題する" }).tap();
    await page.locator(".underline-toggle").tap();
    const body = page.locator(".question-body");
    const selected = await body.evaluate((element) => {
      const range = document.createRange();
      range.setStart(element.firstChild!, 1);
      range.setEnd(element.firstChild!, 6);
      const selection = getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString();
    });
    await page.getByRole("button", { name: "選択範囲に下線を引く" }).tap();
    const mark = body.locator(".question-underline");
    await expect(mark).toHaveText(selected);
    await mark.tap();
    await expect(mark).toHaveCount(0);
  });
});
