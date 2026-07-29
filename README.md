# TheFloor Timer

A synchronized two-team timer designed for computers, phones, tablets, and separate team displays.

## Features

- Two synchronized team clocks
- Main controller and remote-trigger page
- Dedicated Team A and Team B display pages
- Start, pause, reset, and fullscreen controls
- Editable team names and starting time
- Live time adjustments while the clock is running
- Add 30 seconds, add 1 minute, add custom time, or remove 30 seconds
- Keyboard controls: Space to start/pause, A for Team A finished, L for Team B finished, and R to reset

## Pages

- `/` — controller and remote
- `/team-a` — Team A display
- `/team-b` — Team B display

## Run locally

Install Node.js 20 or newer, then run:

```bash
npm start
```

Open `http://localhost:3000`.

## Deploy on Render

This repository includes `render.yaml`.

1. Sign in to Render.
2. Create a new Blueprint.
3. Connect the `joewalls3/thefloor-timer` repository.
4. Approve the service and deploy it.

After deployment, use the Render address for the controller. Add `/team-a` or `/team-b` for the separate team screens.

## Important hosting note

Timer state is currently stored in the running Node.js process. Restarting or redeploying the service resets the timer. A single running server keeps all connected displays synchronized.
