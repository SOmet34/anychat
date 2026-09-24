# AnyChat — Chat with any AI using your own API key

A simple, hostable chat app. Plug in an API key for **OpenAI** (or any OpenAI-compatible provider) or **Anthropic (Claude)** and chat, with streaming, markdown rendering, and saved conversations.

The app is 100% static (no build step). Your API key is stored only in your browser's `localStorage`.

## Live

**https://somet34.github.io/anychat/**

## ⚠️ You must run the proxy first

OpenAI and Anthropic **block browser requests** with CORS — a browser cannot call their APIs directly. That's why the app has a **Proxy URL** setting. Run the included `proxy.js` server (zero dependencies, plain Node) and point the app at it:

```bash
node proxy.js
# → AnyChat proxy running on http://localhost:3000
```

Then in the app's Settings:

1. **API key** — your OpenAI `sk-…` or Anthropic `sk-ant-…`
2. **Base URL** — leave blank for the provider default, or set a custom one
3. **Proxy URL** — `http://localhost:3000` (or your server's address once hosted)
4. **Model** — leave blank, or type one (the dropdown auto-loads the provider's model list)
5. Save → chat

### Host the proxy (any free host)

- **Render**: create a Web Service, point at this repo, build command `node proxy.js`, start command `node proxy.js`
- **Railway**: `railway deploy` from this repo
- **Fly.io**: `fly deploy` (add a `fly.toml` — ask and I'll write one)
- **Cloudflare Workers**: paste `worker.js` into the Workers dashboard, or `npx wrangler deploy worker.js`

## Run locally

```bash
node proxy.js          # terminal 1
npx serve .            # terminal 2, or: python -m http.server 8000
```

Then open `http://localhost:8000`.

## Host the app on GitHub Pages

1. Create a new repository on GitHub.
2. Push this folder:
   ```bash
   git init
   git add .
   git commit -m "AnyChat"
   git remote add origin https://github.com/YOUR_USERNAME/anychat.git
   git push -u origin main
   ```
3. **Settings → Pages → Source**: branch `main`, folder `/ (root)` → **Save**.
4. Live at `https://YOUR_USERNAME.github.io/anychat/` in ~30 seconds.

> GitHub Pages is public — anyone who finds the URL gets the app, but never your API key (it lives only in each visitor's browser).

## Features

- 🔑 Bring your own API key (OpenAI / OpenAI-compatible, or Anthropic)
- ⚡ Streaming responses
- 📝 Markdown + code-block rendering
- 💬 Multiple conversations, saved locally
- 🧠 Auto-loads the provider's model list; also supports custom models
- 🎚️ Temperature and max-token controls
- 📱 Mobile-friendly

## Security notes

- Your key is sent **only** to the provider you configure, routed through your own proxy.
- The proxy forwards the `Authorization` / `x-api-key` header straight through — it never logs or stores your key.
- "Clear local data" in Settings wipes the key and all conversations from your browser.