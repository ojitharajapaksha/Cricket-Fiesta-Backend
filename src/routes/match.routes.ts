import { Router } from 'express';
import { prisma } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

// Get all matches
router.get('/', async (req, res, next) => {
  try {
    const { status, teamId } = req.query;

    const where: any = {};
    if (status) where.status = status;
    if (teamId) {
      where.OR = [
        { homeTeamId: teamId },
        { awayTeamId: teamId },
      ];
    }

    const matches = await prisma.match.findMany({
      where,
      include: {
        homeTeam: true,
        awayTeam: true,
      },
      orderBy: {
        scheduledTime: 'asc',
      },
    });

    res.json({
      status: 'success',
      data: matches,
      count: matches.length,
    });
  } catch (error) {
    next(error);
  }
});

// Get match by ID with full details
router.get('/:id', async (req, res, next) => {
  try {
    const match = await prisma.match.findUnique({
      where: { id: req.params.id },
      include: {
        homeTeam: {
          include: {
            players: true,
          },
        },
        awayTeam: {
          include: {
            players: true,
          },
        },
        commentary: {
          orderBy: {
            timestamp: 'desc',
          },
          take: 50,
        },
        performances: {
          include: {
            player: true,
          },
        },
      },
    });

    if (!match) {
      throw new AppError('Match not found', 404);
    }

    res.json({
      status: 'success',
      data: match,
    });
  } catch (error) {
    next(error);
  }
});

// Create match
router.post('/', async (req, res, next) => {
  try {
    const match = await prisma.match.create({
      data: req.body,
      include: {
        homeTeam: true,
        awayTeam: true,
      },
    });

    res.status(201).json({
      status: 'success',
      data: match,
    });
  } catch (error) {
    next(error);
  }
});

// Update match
router.patch('/:id', async (req, res, next) => {
  try {
    const match = await prisma.match.update({
      where: { id: req.params.id },
      data: req.body,
      include: {
        homeTeam: true,
        awayTeam: true,
      },
    });

    // Broadcast match update
    // io.to(`match:${match.id}`).emit('match:update', match);

    res.json({
      status: 'success',
      data: match,
    });
  } catch (error) {
    next(error);
  }
});

// Start match
router.post('/:id/start', async (req, res, next) => {
  try {
    const match = await prisma.match.update({
      where: { id: req.params.id },
      data: {
        status: 'LIVE',
        actualStartTime: new Date(),
      },
    });

    // Broadcast match started
    // io.emit('match:status-change', { matchId: match.id, status: 'LIVE' });

    res.json({
      status: 'success',
      data: match,
    });
  } catch (error) {
    next(error);
  }
});

// End match
router.post('/:id/end', async (req, res, next) => {
  try {
    const { winnerId, result } = req.body;

    const match = await prisma.match.update({
      where: { id: req.params.id },
      data: {
        status: 'COMPLETED',
        endTime: new Date(),
        winnerId,
        result,
      },
    });

    res.json({
      status: 'success',
      data: match,
    });
  } catch (error) {
    next(error);
  }
});

// Update score
router.post('/:id/score', async (req, res, next) => {
  try {
    const { homeScore, awayScore } = req.body;

    const match = await prisma.match.update({
      where: { id: req.params.id },
      data: {
        homeScore,
        awayScore,
      },
    });

    // Broadcast score update
    // io.to(`match:${match.id}`).emit('match:score-update', match);

    res.json({
      status: 'success',
      data: match,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
