# Project Rules & Architecture Guidelines

## 1. Tech Stack & Environment
- **Frontend:** Next.js (App Router), React, TypeScript (strict), Tailwind CSS v4
- **Backend / API:** Hono on Cloudflare Workers
- **Database / Storage:** Cloudflare D1 (SQLite), Drizzle ORM, Cloudflare R2
- **Auth:** Supabase Auth
- *(※ Laravel プロジェクトの場合は上記を Laravel 11 / PHP 8.3 / PostgreSQL + PGroonga / Filament / Vite に読み替えて適用)*

## 2. Coding & Implementation Rules
- **Type Safety:** `any` の使用は厳禁。既存の Drizzle スキーマや Zod バリデーションから型を推論（`typeof table.$inferSelect` 等）すること。
- **Minimal Diffs:** 指示された対象ファイルと直接関係のないファイルのフォーマット変更・リファクタリングは勝手に行わないこと。
- **Existing Utilities:** 新規でヘルパー関数や認証チェック、DBクライアント初期化を書く前に、必ず既存の `src/lib/` や `src/utils/` 内の実装を確認し流用すること。
- **UI / Styling:** Tailwind CSS v4 のユーティリティクラスを使用し、インラインスタイルや新規 CSS ファイルは追加しない。管理画面・一覧画面は情報密度の高いコンパクトなレイアウト（stickyヘッダー、明確なステータス表示、ダークモード対応）を基本とする。

## 3. Workflow & Token Optimization
- **Plan First:** 複数ファイルにまたがる変更を行う前は、必ず変更対象ファイルと変更概要を簡潔に提示し、承認を得てから編集を開始すること。
- **Targeted Search:** ファイル検索時はプロジェクト全体を走査せず、`src/` 配下の該当ドメインディレクトリのみを対象とすること。
- **No Unnecessary Commands:** 確認のために不要なビルドやテストを連続実行しないこと。型チェックが必要な場合は最小限のコマンドのみ実行する。