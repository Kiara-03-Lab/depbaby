# DepBaby - Deployment Tool for 5yo

Upload HTML → Get URL. No vendor lock-in.

## Quick Start

### Prerequisites
- Docker & Docker Compose
- git

### Run locally

```bash
# Clone repo
git clone <repo-url>
cd vercel-kids

# Start services (backend + Minio)
docker-compose up -d

# Initialize Minio bucket + lifecycle policy
bash setup-minio.sh

# Backend ready at http://localhost:3000
# Minio console at http://localhost:9001 (minioadmin / minioadmin)
```

### Test the API

```bash
# Upload an HTML file
curl -X POST http://localhost:3000/api/deploy \
  -F "file=@test.html"

# Response:
# {
#   "slug": "happy-cat-1234",
#   "url": "http://localhost:3000/happy-cat-1234",
#   "qrCode": "https://api.qrserver.com/..."
# }

# View deployed file
curl http://localhost:3000/happy-cat-1234
```

## Architecture

```
VPS / Docker Host
├── Node.js Express (port 3000)
│   ├── POST /api/deploy    → validate + upload to Minio
│   ├── GET /:slug          → fetch from Minio
│   └── Rate limit: 1/5min per IP
├── Minio S3 (port 9000, 9001 console)
│   ├── Bucket: kids-html
│   └── Lifecycle: auto-delete after 30 days
```

## Environment Variables

```env
NODE_ENV=production
PORT=3000
MINIO_ENDPOINT=http://minio:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
BASE_URL=http://your-domain.com  # For production
```

## API Reference

### POST /api/deploy
Upload HTML file for deployment.

**Request:**
```
Content-Type: multipart/form-data
file: [.html file, max 10MB]
```

**Response (200):**
```json
{
  "slug": "happy-cat-1234",
  "url": "http://localhost:3000/happy-cat-1234",
  "qrCode": "https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=..."
}
```

**Errors:**
- 400: No file / wrong format
- 429: Too many requests (rate limited)
- 500: Server error

### GET /:slug
Retrieve deployed HTML file.

**Response (200):** HTML content, `text/html` MIME type

**Errors:**
- 404: File not found
- 500: Server error

### GET /health
Health check.

**Response (200):**
```json
{ "status": "ok" }
```

## Development

### Local without Docker

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Requires Minio running separately or mocked S3
```

### Build for production

```bash
npm run build
npm start
```

## Deployment

### Single VPS (DigitalOcean, Linode, etc.)

1. **SSH into VPS**
   ```bash
   ssh root@your-vps-ip
   ```

2. **Install Docker**
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```

3. **Clone repo & start**
   ```bash
   git clone <repo-url>
   cd vercel-kids
   docker-compose up -d
   bash setup-minio.sh
   ```

4. **Point domain**
   ```
   Update BASE_URL in docker-compose.yml to your domain
   Restart: docker-compose restart
   ```

5. **(Optional) Add SSL with Caddy**
   Add to docker-compose.yml:
   ```yaml
   caddy:
     image: caddy:latest
     ports:
       - "80:80"
       - "443:443"
     volumes:
       - ./Caddyfile:/etc/caddy/Caddyfile
       - caddy-data:/data
     networks:
       - kids-network
   ```

## File Storage

- **Default:** Minio (S3-compatible, self-hosted)
- **Lifecycle:** Files auto-delete after 30 days
- **Slug format:** `{adjective}-{animal}-{4-digit-number}` (e.g., `happy-cat-1234`)
- **Max size:** 10MB per file

## Rate Limiting

- **Limit:** 1 upload per IP per 5 minutes
- **Response:** 429 Too Many Requests
- **Storage:** In-memory (resets on restart, use Redis for multi-instance)

## License

MIT

## Questions?

- Minio docs: https://docs.min.io
- Express docs: https://expressjs.com
- AWS S3 SDK: https://docs.aws.amazon.com/sdk-for-javascript/
