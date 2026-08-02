# Sit-Sync web portal

The Vite application contains two intentionally separate experiences:

- `/` — public product showcase
- `/#/login` — user login
- `/#/app` — protected live monitor
- `/#/dashboard`, `/#/calendar`, `/#/report`, `/#/settings` — protected pages

Hash routing keeps direct refreshes compatible with static S3 hosting. Protected
portal pages are loaded as separate chunks, so the public page does not
immediately load the 3D monitor.

## Local development

```sh
npm install
npm run dev
```

## Configuration

Create a local `.env` as needed:

```text
VITE_API_BASE_URL=https://api.example.com
VITE_WS_URL=wss://api.example.com
VITE_DEMO_VIDEO_URL=https://cdn.example.com/sit-sync-demo.mp4
```

`VITE_DEMO_VIDEO_URL` is optional. Without it, the showcase renders an explicit
video placeholder with replacement instructions. Keep large videos in S3,
CloudFront, or a streaming service rather than in the JavaScript bundle.

## Build and deploy

```sh
npm run lint
npm run build
aws s3 sync dist "s3://YOUR_BUCKET" --delete
```

Invalidate CloudFront after replacing the static files. Product result values
and evidence labels live in `src/content/productResults.ts`; update them only
when their supporting evaluation evidence changes.
