import { Server, Socket } from 'socket.io';
import { logger } from '../utils/logger';
import { cacheService } from '../utils/redis';

export const initializeWebSocket = (io: Server) => {
  logger.info('🔌 Initializing WebSocket server');

  io.on('connection', (socket: Socket) => {
    logger.info(`✅ Client connected: ${socket.id}`);

    // Track active users
    trackActiveUser(socket);

    // Match events
    socket.on('match:subscribe', (matchId: string) => {
      socket.join(`match:${matchId}`);
      logger.info(`Client ${socket.id} subscribed to match ${matchId}`);
    });

    socket.on('match:unsubscribe', (matchId: string) => {
      socket.leave(`match:${matchId}`);
    });

    // Live score updates
    socket.on('match:score-update', (data) => {
      io.to(`match:${data.matchId}`).emit('match:score-update', data);
      io.emit('live-feed:update', {
        type: 'MATCH_SCORE',
        data,
        timestamp: new Date(),
      });
    });

    // Commentary events
    socket.on('commentary:new', (data) => {
      io.to(`match:${data.matchId}`).emit('commentary:new', data);
    });

    // Food queue updates
    socket.on('food:queue-update', (data) => {
      io.emit('food:queue-update', data);
    });

    // Player registration events
    socket.on('player:registration', (data) => {
      io.emit('player:registration', data);
      io.emit('stats:update', { type: 'registration', data });
    });

    // Photo upload events
    socket.on('photo:uploaded', (data) => {
      io.emit('photo:uploaded', data);
    });

    // Emergency alerts
    socket.on('emergency:alert', (data) => {
      io.emit('emergency:alert', {
        ...data,
        priority: 'CRITICAL',
        timestamp: new Date(),
      });
      logger.warn(`Emergency alert: ${data.message}`);
    });

    // Notifications
    socket.on('notification:send', (data) => {
      if (data.targetAudience === 'all') {
        io.emit('notification:new', data);
      } else if (data.targetUserId) {
        io.to(data.targetUserId).emit('notification:new', data);
      }
    });

    // Poll voting
    socket.on('poll:vote', (data) => {
      io.emit('poll:update', data);
    });

    // Match status changes
    socket.on('match:status-change', (data) => {
      io.emit('match:status-change', data);
      io.to(`match:${data.matchId}`).emit('match:status-change', data);
    });

    // Weather updates
    socket.on('weather:update', (data) => {
      io.emit('weather:update', data);
    });

    // Team assignment notifications
    socket.on('team:assigned', (data) => {
      io.emit('team:assigned', data);
    });

    // Award announcements
    socket.on('award:announced', (data) => {
      io.emit('award:announced', data);
    });

    // Disconnect event
    socket.on('disconnect', () => {
      logger.info(`❌ Client disconnected: ${socket.id}`);
      removeActiveUser(socket);
    });
  });

  // Broadcast functions
  return {
    broadcastMatchUpdate: (matchId: string, data: any) => {
      io.to(`match:${matchId}`).emit('match:score-update', data);
    },

    broadcastLiveUpdate: (data: any) => {
      io.emit('live-feed:update', data);
    },

    broadcastNotification: (userId: string | null, data: any) => {
      if (userId) {
        io.to(userId).emit('notification:new', data);
      } else {
        io.emit('notification:new', data);
      }
    },

    broadcastEmergency: (data: any) => {
      io.emit('emergency:alert', {
        ...data,
        priority: 'CRITICAL',
        timestamp: new Date(),
      });
    },

    getActiveUsersCount: async () => {
      const count = await cacheService.get('active_users_count');
      return parseInt(count || '0');
    },
  };
};

// Track active users
async function trackActiveUser(socket: Socket) {
  const currentCount = await cacheService.get('active_users_count');
  const newCount = (parseInt(currentCount || '0') + 1).toString();
  await cacheService.set('active_users_count', newCount);
  
  // Broadcast active user count
  socket.broadcast.emit('stats:active-users', { count: newCount });
}

async function removeActiveUser(socket: Socket) {
  const currentCount = await cacheService.get('active_users_count');
  const newCount = Math.max(0, parseInt(currentCount || '0') - 1).toString();
  await cacheService.set('active_users_count', newCount);
  
  socket.broadcast.emit('stats:active-users', { count: newCount });
}
