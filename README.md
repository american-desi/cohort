# Cohort

**Find your cohort. Build your company.**

Cohort is the open-source, community-driven online Y Combinator. Great companies
start with the right people in the same room — Cohort makes that room the
internet. Builders from anywhere meet here, pitch what they want to make, form
teams around shared conviction, and start working immediately in a live,
collaborative workspace with an AI co-builder sitting in the group chat. No
applications, no gatekeepers, no equity taken: the accelerator is the
community itself, and the whole thing is MIT-licensed so anyone can run,
fork, and improve it.

## Features

- **Projects board** — pitch an idea in one breath, tag the roles you're
  looking for, and let the community find you.
- **Real-time workspace** — every project gets a shared live-editing document
  and a group chat, synced over WebSockets.
- **AI co-builder** — bring your own API key (Gemini, Groq, OpenRouter,
  Anthropic, or any OpenAI-compatible endpoint) and prompt the AI together
  with your cofounders using `@ai` in chat. Replies go to the whole room.
- **Upvotes & leaderboard** — back the projects you believe in; the best rise.
- **Live Hacker News feed** — the top 30 stories, proxied and cached
  server-side, so the community stays plugged into the ecosystem.

## Quickstart

```bash
npm install
node server.js
```

Then open [http://localhost:3000](http://localhost:3000).

State lives in a single `data.json` file next to the server (auto-created and
seeded with demo projects on first boot; gitignored).

## Bring your own AI key

Cohort never stores your AI key on the server. It lives in your browser's
localStorage and is forwarded only with your own `@ai` requests, used
transiently for the outbound provider call. Configure it via **⚙ AI Settings**
in the top nav.

| Provider   | Free tier (approx.)   | Get a key                                                |
| ---------- | --------------------- | -------------------------------------------------------- |
| Gemini     | ~1,500 requests/day   | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| Groq       | ~1,000 requests/day   | [console.groq.com](https://console.groq.com)             |
| OpenRouter | free-tier models      | [openrouter.ai](https://openrouter.ai)                    |
| Anthropic  | pay-as-you-go         | [console.anthropic.com](https://console.anthropic.com)    |

Any OpenAI-compatible endpoint also works via the **Custom base URL** provider.

## Roadmap

- **Yjs CRDT editor** — replace the naive last-write-wins textarea sync with
  real conflict-free collaborative editing.
- **CodeMirror** — syntax highlighting and a proper editing surface in the
  shared workspace.
- **Founder profiles** — skills, timezone, track record, past cohorts.
- **Demo days** — scheduled community showcases with live voting.
- **Age-gated tracks** — a safe, moderated track for young builders.

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Cohort contributors.

## Built on the shoulders of giants

[Express](https://expressjs.com) · [ws](https://github.com/websockets/ws) ·
[Hacker News API](https://github.com/HackerNews/API) (Y Combinator) ·
the OpenAI-compatible chat completions convention adopted by
Google, Groq and OpenRouter · and the Y Combinator ethos of
*make something people want*, which this project tries to give away for free.
