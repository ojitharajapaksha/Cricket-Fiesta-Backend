# Cricket Fiesta Backend API

Backend API for SLT Cricket Fiesta Event Management System with real-time features.

## 🚀 Features

- **RESTful API** with Express.js
- **Real-time Updates** with Socket.IO
- **PostgreSQL Database** with Prisma ORM
- **Redis Caching** for performance
- **QR Code Generation** for players
- **Real-time Analytics** and dashboards
- **Live Match Scoring** with commentary
- **Food Distribution Management**
- **Emergency Incident Management**
- **Photo Gallery** with moderation
- **Polls & Voting System**

## 📦 Tech Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL (NeonDB recommended)
- **ORM**: Prisma
- **Real-time**: Socket.IO
- **Caching**: Redis (Upstash Redis recommended)
- **File Upload**: Cloudinary
- **Logging**: Winston

## 🛠️ Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Update the following variables:
- `DATABASE_URL`: Your PostgreSQL connection string
- `REDIS_URL`: Your Redis connection string
- `JWT_SECRET`: Random secret key
- `FRONTEND_URL`: Your frontend URL
- `CLOUDINARY_*`: Cloudinary credentials (optional)

### 3. Database Setup

Generate Prisma client:
```bash
npm run prisma:generate
```

Push schema to database:
```bash
npm run prisma:push
```

Or run migrations:
```bash
npm run prisma:migrate
```

### 4. Start Development Server

```bash
npm run dev
```

Server will run on `http://localhost:5000`

## 🌐 Deployment on Render

### Steps:

1. **Create New Web Service** on Render
2. **Connect Repository** (GitHub/GitLab)
3. **Configure Build Settings**:
   - **Build Command**: `npm install && npm run build && npm run prisma:generate`
   - **Start Command**: `npm start`
4. **Environment Variables**: Add all from `.env.example`
5. **Deploy**

### Render.yaml (Auto-deploy config)

```yaml
services:
  - type: web
    name: cricket-fiesta-backend
    env: node
    buildCommand: npm install && npm run build && npm run prisma:generate
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        sync: false
      - key: REDIS_URL
        sync: false
```

## 📡 API Endpoints

### Players
- `GET /api/players` - Get all players
- `POST /api/players` - Create player
- `GET /api/players/:id` - Get player details
- `PATCH /api/players/:id` - Update player
- `POST /api/players/:id/attendance` - Mark attendance
- `POST /api/players/:id/food-collect` - Mark food collected
- `POST /api/players/scan` - Scan QR code

### Teams
- `GET /api/teams` - Get all teams
- `POST /api/teams` - Create team
- `GET /api/teams/:id` - Get team details

### Matches
- `GET /api/matches` - Get all matches
- `POST /api/matches` - Create match
- `GET /api/matches/:id` - Get match details
- `POST /api/matches/:id/start` - Start match
- `POST /api/matches/:id/end` - End match
- `POST /api/matches/:id/score` - Update score

### Dashboard
- `GET /api/dashboard/stats` - Real-time statistics
- `GET /api/dashboard/registration-by-department` - Department breakdown
- `GET /api/dashboard/food-preferences` - Food preferences
- `GET /api/dashboard/recent-activity` - Recent activities

### Live Updates
- `GET /api/live-updates` - Get live updates
- `POST /api/live-updates` - Create update

### Food Management
- `GET /api/food` - Get food counters
- `PATCH /api/food/queue/:counterName` - Update queue

### More endpoints available in route files...

## 🔌 WebSocket Events

### Client -> Server
- `match:subscribe` - Subscribe to match updates
- `match:score-update` - Broadcast score update
- `food:queue-update` - Update queue status
- `emergency:alert` - Send emergency alert
- `notification:send` - Send notification

### Server -> Client
- `match:score-update` - Receive score updates
- `live-feed:update` - Live feed updates
- `notification:new` - New notification
- `emergency:alert` - Emergency alert
- `stats:update` - Statistics update
- `photo:uploaded` - New photo uploaded

## 📝 Database Schema

See `prisma/schema.prisma` for complete schema with:
- Players, Teams, Matches
- Live Commentary, Match Performances
- Food Management, Committee
- Awards, Photos, Polls
- Notifications, Incidents, Analytics
- And more...

## 🔐 Security

- Helmet.js for security headers
- CORS configuration
- Rate limiting
- Input validation
- Error handling

## 📊 Monitoring

- Winston logging
- Error logs: `logs/error.log`
- Combined logs: `logs/combined.log`

## 🤝 Contributing

1. Create feature branch
2. Make changes
3. Test thoroughly
4. Submit PR

## 📄 License

MIT License
