import { Router } from 'express';
import { prisma } from '../utils/prisma';

const router = Router();

// Get real-time dashboard statistics
router.get('/stats', async (req, res, next) => {
  try {
    const [
      totalPlayers,
      attendedPlayers,
      totalTeams,
      totalMatches,
      liveMatches,
      completedMatches,
      totalFoodRegistrations,
      foodCollected,
      committeeMembers,
      activeCommittee,
    ] = await Promise.all([
      prisma.player.count(),
      prisma.player.count({ where: { attended: true } }),
      prisma.team.count(),
      prisma.match.count(),
      prisma.match.count({ where: { status: 'LIVE' } }),
      prisma.match.count({ where: { status: 'COMPLETED' } }),
      prisma.foodRegistration.count(),
      prisma.foodRegistration.count({ where: { foodCollected: true } }),
      prisma.committee.count(),
      prisma.committee.count({ where: { checkedIn: true } }),
    ]);

    const stats = {
      players: {
        total: totalPlayers,
        attended: attendedPlayers,
        attendanceRate: totalPlayers > 0 ? (attendedPlayers / totalPlayers) * 100 : 0,
      },
      teams: {
        total: totalTeams,
      },
      matches: {
        total: totalMatches,
        live: liveMatches,
        completed: completedMatches,
        upcoming: totalMatches - liveMatches - completedMatches,
      },
      food: {
        total: totalFoodRegistrations,
        collected: foodCollected,
        pending: totalFoodRegistrations - foodCollected,
        collectionRate: totalFoodRegistrations > 0 ? (foodCollected / totalFoodRegistrations) * 100 : 0,
      },
      committee: {
        total: committeeMembers,
        active: activeCommittee,
      },
    };

    res.json({
      status: 'success',
      data: stats,
    });
  } catch (error) {
    next(error);
  }
});

// Get department-wise registration
router.get('/registration-by-department', async (req, res, next) => {
  try {
    const players = await prisma.player.groupBy({
      by: ['department'],
      _count: true,
    });

    res.json({
      status: 'success',
      data: players.map(p => ({
        department: p.department,
        count: p._count,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// Get food preferences breakdown
router.get('/food-preferences', async (req, res, next) => {
  try {
    const preferences = await prisma.foodRegistration.groupBy({
      by: ['foodPreference'],
      _count: true,
    });

    res.json({
      status: 'success',
      data: preferences.map(p => ({
        preference: p.foodPreference,
        count: p._count,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// Get recent activity
router.get('/recent-activity', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;

    const activities = await prisma.analytics.findMany({
      take: limit,
      orderBy: {
        timestamp: 'desc',
      },
    });

    res.json({
      status: 'success',
      data: activities,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
