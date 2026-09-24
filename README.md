# AnyChat — Chat with any AI using your own API key

A simple, hostable chat app. Plug in an API key for **OpenAI** (or any OpenAI-compatible provider) or **Anthropic (Claude)** and chat, with streaming, markdown rendering, and saved conversations.

Everything is 100% static — no backend, no build step. Your API key is stored only in your browser's `localStorage`.

## Run locally

Just open `index.html` in a browser, or serve the folder:

```bash
npx serve .
# or
python -m http.server 8000
```

## Host on GitHub Pages

1. Create a new repository on GitHub.
2. Push this folder:
   ```bash
   git init
   git add .
   git commit -m "AnyChat"
   git remote add origin https://github.com/YOUR_USERNAME/anychat.git
   git push -u origin main
   ```
3. In the repo: **Settings → Pages → Source**: pick **Deploy from a branch**, branch `main`, folder `/ (root)` → **Save**.
4. Your site will be live at `https://YOUR_USERNAME.github.io/anychat/` in ~30 seconds.

> ⚠️ **GitHub Pages is public** — anyone who finds the URL gets the app itself, but never your API key (it lives only in each visitor's own browser).

## Features

- 🔑 Bring your own API key (OpenAI / OpenAI-compatible, or Anthropic)
- ⚡ Streaming responses
- 📝 Markdown + code-block rendering
- 💬 Multiple conversations, saved locally
- 🧠 Auto-loads the provider's model list; also supports custom models
- 🎚 Temperature and max-token controls
- 📱 Mobile-friendly

## Security notes

- Your key is sent **only** to the provider you configure, directly from the browser.
- Anthropic has CORS enabled for browser requests; OpenAI also allows it (they recommend server-side proxies for production sites, but it works fine here as long as you keep the URL private).
- "Clear local data" in Settings wipes the key and all conversations.
