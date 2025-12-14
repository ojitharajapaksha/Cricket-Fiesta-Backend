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
    const { isProjectMatch, homeProject, awayProject, ...matchData } = req.body;

    // Get next match number
    const lastMatch = await prisma.match.findFirst({
      orderBy: { matchNumber: 'desc' },
    });
    const matchNumber = (lastMatch?.matchNumber || 0) + 1;

    let homeTeamId = matchData.homeTeamId;
    let awayTeamId = matchData.awayTeamId;

    // If it's a project-based match, create or find teams for projects
    if (isProjectMatch && homeProject && awayProject) {
      // Find or create home team for project
      let homeTeam = await prisma.team.findFirst({
        where: { name: homeProject },
      });
      if (!homeTeam) {
        homeTeam = await prisma.team.create({
          data: {
            name: homeProject,
            color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0'),
          },
        });
      }
      homeTeamId = homeTeam.id;

      // Find or create away team for project
      let awayTeam = await prisma.team.findFirst({
        where: { name: awayProject },
      });
      if (!awayTeam) {
        awayTeam = await prisma.team.create({
          data: {
            name: awayProject,
            color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0'),
          },
        });
      }
      awayTeamId = awayTeam.id;
    }

    if (!homeTeamId || !awayTeamId) {
      throw new AppError('Home team and away team are required', 400);
    }

    const match = await prisma.match.create({
      data: {
        ...matchData,
        matchNumber,
        homeTeamId,
        awayTeamId,
      },
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
