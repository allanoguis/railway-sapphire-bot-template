# Token Torn dashboard

This React, TypeScript, and Vite frontend is built from the repository root with `pnpm build` alongside the bot. The production output is `web/dist`; the bot's HTTP server serves it when the website is configured.

The backend provides `/auth/discord` and `/api/*` on the same origin. The frontend uses relative URLs and same-origin credentials, expects JSON `{ data: ... }` or `{ error: string }` responses, and takes the CSRF token from `/api/session` for every POST. Configure the website and its Discord OAuth callback as described in the root README; a separate Vite development server is not configured.

The dashboard makes requests only on user actions, except for loading or refreshing the session. Cancelling a mutation aborts the browser request but cannot guarantee the server did not process it; the dashboard refreshes the session afterward. API keys are held only in component/request memory and cleared from the input on submission, cancellation, or navigation.
