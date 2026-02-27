import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import path from 'path';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 3000;

// Minio S3 client configuration
const s3Client = new S3Client({
  region: 'us-east-1',
  endpoint: process.env.MINIO_ENDPOINT || 'http://minio:9000',
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretAccessKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
  },
  forcePathStyle: true,
});

const BUCKET_NAME = 'kids-html';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Rate limiting: simple in-memory store (IP → timestamps)
const rateLimitStore = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_MAX = 1; // 1 upload per window

// Multer for file upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/html' || file.originalname.endsWith('.html')) {
      cb(null, true);
    } else {
      cb(new Error('Only .html files are allowed'));
    }
  },
});

// Rate limiting middleware
const rateLimitMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const ip = req.ip || 'unknown';
  const now = Date.now();

  if (!rateLimitStore.has(ip)) {
    rateLimitStore.set(ip, []);
  }

  const timestamps = rateLimitStore.get(ip)!;
  // Remove timestamps older than window
  const recentTimestamps = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW);

  if (recentTimestamps.length >= RATE_LIMIT_MAX) {
    return res.status(429).json({
      error: 'Too many requests. Try again in 5 minutes.',
    });
  }

  recentTimestamps.push(now);
  rateLimitStore.set(ip, recentTimestamps);
  next();
};

// Generate random slug
function generateSlug(): string {
  const adjectives = ['happy', 'silly', 'bouncy', 'swift', 'clever', 'bright', 'zippy', 'quirky'];
  const animals = ['cat', 'dog', 'fox', 'panda', 'penguin', 'dolphin', 'otter', 'eagle'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  const num = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `${adj}-${animal}-${num}`;
}

// Deploy endpoint
app.post(
  '/api/deploy',
  rateLimitMiddleware,
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const slug = generateSlug();
      const fileName = `${slug}.html`;

      // Upload to Minio
      await s3Client.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: fileName,
          Body: req.file.buffer,
          ContentType: 'text/html; charset=utf-8',
          Metadata: {
            'original-filename': req.file.originalname,
            'upload-timestamp': new Date().toISOString(),
          },
        })
      );

      const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
      const deploymentUrl = `${baseUrl}/${slug}`;

      res.json({
        slug,
        url: deploymentUrl,
        qrCode: `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(deploymentUrl)}`,
      });
    } catch (error) {
      console.error('Deploy error:', error);
      res.status(500).json({ error: 'Deployment failed' });
    }
  }
);

// Serve deployed HTML
app.get('/:slug', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;

    // Validate slug format (prevent directory traversal)
    if (!/^[a-z]+-[a-z]+-\d{4}$/.test(slug)) {
      return res.status(404).send('Not found');
    }

    const fileName = `${slug}.html`;

    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: fileName,
      })
    );

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    // Stream the file
    if (response.Body instanceof Readable) {
      response.Body.pipe(res);
    } else {
      res.send(await response.Body?.transformToString());
    }
  } catch (error: any) {
    if (error.name === 'NoSuchKey') {
      return res.status(404).send('File not found');
    }
    console.error('Fetch error:', error);
    res.status(500).send('Error retrieving file');
  }
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📤 Upload: POST /api/deploy`);
  console.log(`📄 View: GET /:slug`);
});
