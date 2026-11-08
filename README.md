# 漫才ノート

iPhone の Safari から使える漫才メモと台本の PWA です。共有メニューの「ホーム画面に追加」からアプリのように開けます。

## 使い方

1. 起動時のクイックメモに入力し、「メモを保存」を押します。入力途中の下書きは端末に自動保存します。
2. メモを右にフリックすると「ネタ候補」、左にフリックすると「保留」になります。カードのメニューからも変更できます。
3. 「ネタ作成」で最大8件のメモ、尺、形式を選びます。Google でログインすると、選んだメモを Workers AI に送信できます。
4. 台本画面で題材、笑いのズレ、オチ、ボケとツッコミのセリフ、元のメモを確認できます。台本の編集とコピーにも対応しています。

ログイン前は入力とメモを端末に保存します。初回ログイン時にその端末のゲストメモをログイン先のアカウントに移し、D1 に同期します。下書きは保存ボタンを押した時点で同期対象になります。ログイン後に通信が切れた場合は、開いているアプリで編集を続けられます。オフラインで起動した場合はログイン済みのデータを表示する前にセッション確認が必要なので、ゲストとしてメモを取れます。

## 技術選定

| 技術 | 選んだ理由 |
| --- | --- |
| HTML、CSS、TypeScript | 起動時にメモ欄を描画するため、フロントエンドのランタイム依存を省きました。メモの状態や台本の型は Worker と共有し、サーバー側でも形式を検証します。 |
| Vite | 開発中の更新と本番用のファイル圧縮を同じ設定で扱い、Cloudflare Workers Static Assets に載せられる構成にします。 |
| CSS の透過、背景ぼかし、トランジション | 白と淡い緑を基調に、ナビゲーションやカードに Liquid Glass 風の質感を出します。表示切替、シート、保存通知、全画面スケルトンを CSS で動かし、動きを減らす OS 設定にも対応します。 |
| Pointer Events | 指とマウスで同じフリックを使えます。横方向と縦スクロールを判定し、操作メニューも残しています。 |
| PWA、Service Worker、localStorage | Safari からホーム画面に追加でき、初回読み込み後は電波がない場所でも起動できます。端末に下書きを即時保存し、ログインや通信の完了を待たずに入力できます。Service Worker のキャッシュ対象はアプリの公開ファイルです。 |
| Cloudflare Workers、Static Assets、Wrangler | 画面と API を同一オリジンで配信し、サーバーの常時管理を省けます。Wrangler は構成、ローカル開発、D1 マイグレーション、デプロイに使います。 |
| Cloudflare D1 | メモ、台本、セッションをユーザー単位で分離します。SQL と削除履歴を使い、古い同期リクエストで削除済みメモが復活するのを防ぎます。 |
| Workers AI、Qwen3 30B A3B FP8 | Cloudflare 内のバインディングで推論を呼び出せます。日本語の題材分析と台本生成を1リクエストで行い、JSON Schema で題材・ズレ・オチと役別セリフを分けます。API はユーザー単位の生成回数制限をかけます。 |
| Google OpenID Connect と jose | ログインを Google に一本化します。認可コードフロー、PKCE、state、nonce を使い、jose で署名とトークンの発行者・対象を検証します。アプリのセッションは HttpOnly Cookie と D1 で管理します。 |
| Playwright、Node.js のテストランナー、SQLite | Chromium と iPhone 相当の WebKit で実画面を動かします。API のテストは本番 Worker と同じコードと SQL を使い、外部サービスの応答をテスト専用の値に差し替えます。 |
| GitHub Actions | push と pull request ごとに型検査、API テスト、ブラウザテストを再実行できます。 |

## ローカルで起動

Node.js 22.12 以降が必要です。CI は Node.js 24 で実行します。

```sh
npm ci
npm run dev
```

開発サーバーではメモ機能を試せます。アカウント同期と AI は、Cloudflare と Google の設定後に使用できます。ブラウザテストではテスト用アカウントと Workers AI の応答を使います。

```sh
npx playwright install --with-deps chromium webkit
npm run check
npm run build
npx wrangler deploy --dry-run
```

## Cloudflare に公開

1. `npx wrangler login` で公開先アカウントにログインします。既に同名の Worker がある場合は `wrangler.jsonc` の `name` を固有の名前に変えてください。
2. `npx wrangler d1 create manzai-note` で D1 を作成し、出力された UUID で `wrangler.jsonc` の `database_id` を置き換えます。
3. `npx wrangler d1 migrations apply DB --remote` を実行し、`npm run deploy` で Worker の URL を取得します。
4. Google Auth Platform でウェブアプリの OAuth クライアントを作成します。公開 URL が `https://example.workers.dev` の場合、承認済みリダイレクト URI に `https://example.workers.dev/auth/google/callback` を設定します。Google 側がテスト公開なら対象の Google アカウントをテストユーザーに加えます。
5. 次のシークレットを設定し、`npm run deploy` を再実行します。`APP_ORIGIN` は公開 URL のオリジンのみを入力します。末尾のスラッシュは省きます。

```sh
npx wrangler secret put APP_ORIGIN
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

6. 公開 URL を Safari で開き、実際の Google ログイン、保存・同期、Workers AI 台本生成を確認します。独自ドメインを使う場合は Google 側のリダイレクト URI と `APP_ORIGIN` を揃えます。

GitHub にソースを公開する場合は、作業ディレクトリで最初のコミットを作成し、認証済みの `gh` で実行します。

```sh
gh repo create manzai-note --public --source=. --remote=origin --push
```

## 公式資料

- [iOS のホーム画面 Web アプリ](https://webkit.org/blog/13878/)
- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/binding/)
- [D1 マイグレーション](https://developers.cloudflare.com/d1/reference/migrations/)
- [Workers AI の Qwen3 モデル](https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/)
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
