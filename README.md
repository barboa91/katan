This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/basic-features/font-optimization) to automatically optimize and load Inter, a custom Google Font.

## Running with Docker

For a self-hosted deployment (see `Dockerfile.web`, `Dockerfile.socket`,
`nginx/default.conf`), the whole stack — the Next.js app, the Socket.IO
server, and an nginx reverse proxy that puts both behind a single origin —
runs via Docker Compose:

```bash
docker compose up --build
```

The app is then reachable at `http://localhost` (nginx forwards `/` to the
Next.js app and `/socket.io/` to the Socket.IO server — the browser never
talks to either container directly). Two settings are overridable via a
`.env` file (copy `.env.example`) instead of editing `docker-compose.yml`:
`HTTP_PORT` (which host port nginx binds to, default 80) and
`CLIENT_ORIGIN` (the origin the Socket.IO server accepts connections from —
set this to your real public URL once actually deployed; a real
domain/TLS setup is a deploy-time decision this repo doesn't make for you).

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.
