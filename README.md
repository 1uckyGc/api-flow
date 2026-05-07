# FollowmeeeAIGC

AI-driven image & video production platform for e-commerce content creators. Upload a product photo, describe your vision, and let FollowmeeeAIGC generate professional-quality marketing visuals at scale.

## Features

### Fission Mode (裂变生成)

Batch-generate creative image variations from a single product photo:

1. Upload a **product base image** (and optional person/scene references)
2. Write a brief **global prompt** (e.g. "Western indoor scene, cozy living room")
3. FollowmeeeAIGC's AI expands your prompt into N unique creative descriptions
4. Each description is rendered into a high-quality image variation
5. One-click **video generation** from any image result
6. **Video extension** — seamlessly extend generated clips

### Director Mode (导演模式)

Turn a text script into a coherent storyboard sequence:

1. Upload **product white-background photos**
2. Write a **script** describing the storyline
3. AI breaks the script into N scene descriptions (shot type, action, setting)
4. **Anchor frame** is generated first, establishing the visual identity
5. Remaining frames are generated in parallel, maintaining character/scene consistency
6. One-click **batch video generation** from the completed storyboard

### Utility Tools (工具集)

Standard generation modes for quick one-off tasks:

| Mode | Description |
|---|---|
| **Text-to-Image (文生图)** | Generate images from text prompts |
| **Image-to-Image (图生图)** | Transform existing images with AI |
| **Text-to-Video (文生视频)** | Generate videos from text descriptions |
| **Image-to-Video (图生视频)** | Animate still images into video clips |

### Additional Features

- **Asset Library (资产库)** — Browse all generated outputs with waterfall gallery view
- **Dark / Light Theme** — Full theme system with one-click toggle
- **Real-time Progress** — WebSocket-powered live task status updates
- **Per-user Settings** — Configure API keys, generation parameters, video trim frames

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Python 3.10, FastAPI, SQLAlchemy, Alembic, Celery |
| **Frontend** | React 18, Vite 5, Zustand, TailwindCSS |
| **Database** | PostgreSQL 15 |
| **Cache/Queue** | Redis 7 |
| **Proxy** | Nginx (Alpine) |
| **AI Models** | Gemini (image), Veo (video), DeepSeek (prompt expansion) |
| **AI Gateway** | **HOLO API** (async submit-poll-download, hosted) **or** Flow2API (OpenAI-compatible SSE, self-hosted). Toggled via `AI_PROVIDER` in `.env` |
| **Container** | Docker Compose |

---

## Quick Start

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- AI API keys — either a **HOLO** key (single key for both image & video, recommended) **or** Flow2API self-hosted gateway + DeepSeek

### 1. Clone & Configure

```bash
git clone <your-repo-url>
cd FollowmeeeAIGC
```

Create a `.env` file in the project root:

```env
# Required
SECRET_KEY=your-secret-key-here

# AI Provider — pick one
AI_PROVIDER=holo                              # or "flow2api"
AI_API_URL=https://api.dealonhorizon.us       # HOLO base URL
AI_API_KEY=your-holo-bearer-key
# (Optional) HOLO polling knobs
AI_POLL_TIMEOUT=600
AI_POLL_INTERVAL=5.0

# DeepSeek (prompt expansion, system-level)
DEEPSEEK_API_KEY=your-deepseek-api-key

# Database (matches docker-compose defaults)
DATABASE_URL=postgresql://followmeeeaigc:followmeeeaigc@db:5432/followmeeeaigc

# Redis
REDIS_URL=redis://redis:6379/0

# CORS
CORS_ORIGINS=http://localhost:80,http://localhost:5173
```

> Switching back to Flow2API: set `AI_PROVIDER=flow2api`, point `AI_API_URL` at your gateway (e.g. `http://127.0.0.1:8088`), restart backend + worker. The same model dropdowns will swap to the legacy `*_ultra` / `*_ultra_relaxed` options automatically.

### 2. Launch

```bash
docker-compose up -d --build
```

This starts 5 containers:

| Container | Port | Description |
|---|---|---|
| `followmeeeaigc_frontend` | **80** | Nginx serving React app |
| `followmeeeaigc_backend` | **8000** | FastAPI server |
| `followmeeeaigc_worker` | — | Celery async task worker |
| `followmeeeaigc_db` | 5432 | PostgreSQL |
| `followmeeeaigc_redis` | 6379 | Redis |

### 3. Access

Open your browser and navigate to **http://localhost:80**

### 4. First-time Setup

1. **Register** an account on the login page
2. Open **Settings** (gear icon in sidebar)
3. (HOLO mode) the global key in `.env` already covers everything; **Gemini Key / Veo Key** in user settings can be left empty or both filled with the same HOLO key for per-user isolation. (Flow2API mode) fill in the Gemini / Veo keys you provisioned for the gateway.
4. Start creating!

### Local Dev Mode (db+redis in Docker, backend+frontend native)

Faster iteration than full-Docker — code edits hot-reload, logs go to local files:

```bash
docker compose up -d db redis           # only middleware

cd backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
# In backend/.env, switch to local hosts:
#   DATABASE_URL=postgresql://followmeeeaigc:followmeeeaigc_pass@127.0.0.1:5432/followmeeeaigc_db
#   CELERY_BROKER_URL=redis://127.0.0.1:6379/0
#   WEB_API_URL=http://127.0.0.1:8000
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
# Worker — Windows requires --pool=solo (or threads); prefork is unsupported.
.venv\Scripts\python.exe -m celery -A app.workers.celery_app worker --loglevel=info --pool=solo

cd ../frontend
npm install
npm run dev                              # Vite :5173
```

Browser → `http://localhost:5173` (Vite proxies `/api` → `127.0.0.1:8000`).

---

## User Guide

### Fission Mode — Step by Step

1. Click the **DNA icon (裂变)** in the left sidebar
2. Click **发起新任务** to open the creation modal
3. Upload your **product base images** (the items you're selling)
4. Optionally upload:
   - **Person reference** — lock the model's appearance across all variations
   - **Scene reference** — lock the background/environment style
5. Write a **global prompt** describing the desired direction
6. Set the **number of variations** and choose the AI model
7. Click **开始裂变** — watch progress in real-time
8. Browse results in the detail panel, click any image for full-size preview
9. Use **一键生成视频** to create video clips from successful images
10. Use **视频延展** to extend video duration

### Director Mode — Step by Step

1. Click the **Clapperboard icon (导演模式)** in the left sidebar
2. Click **发起新任务** to open the creation modal
3. Upload **product photos** (white-background recommended)
4. Write your **script** — describe the story scene by scene
5. Set **frame count** (how many storyboard frames to generate)
6. Optionally describe the **character** and **visual style**
7. Click **开始生成** — the AI will:
   - Parse your script into scene descriptions
   - Generate an anchor frame first
   - Then generate remaining frames in parallel
8. Review the film board — frames displayed as vertical 9:16 cards
9. Click **生成视频序列** to batch-convert all frames into video clips
10. Preview videos inline, click to view full-size

### Utility Tools — Step by Step

1. Click any tool icon in the sidebar (**文生图 / 图生图 / 文生视频 / 图生视频**)
2. Fill in the left panel:
   - Enter your **prompt**
   - Upload **reference images** (for I2I and I2V modes)
   - Select the **AI model**
3. Click **生成** to start
4. Results appear in the right-side waterfall gallery
5. Click any result to inspect details in the side panel

### Settings

Access via the **gear icon** at the bottom of the sidebar:

| Setting | Description |
|---|---|
| **Gemini API Key** | Required for image generation |
| **Veo API Key** | Required for video generation |
| **DeepSeek Model** | LLM model for prompt expansion |
| **Video Trim Frames** | Frames to trim from end of generated videos |

### Theme Toggle

Click the **sun/moon icon** in the sidebar to switch between dark and light themes. Your preference is saved automatically.

---

## Development

### Local Frontend Development

```bash
cd frontend
npm install
npm run dev    # Vite dev server on :5173
```

### Backend Development

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Database Migrations

```bash
# Generate a new migration
alembic revision --autogenerate -m "description"

# Apply migrations
alembic upgrade head
```

### Logs

```bash
docker-compose logs -f backend   # API server logs
docker-compose logs -f worker    # Celery task logs
```

---

## Project Structure

See [CLAUDE.md](CLAUDE.md) for a detailed project map, architecture decisions, and development conventions.

---

## License

This project is proprietary software. All rights reserved.
