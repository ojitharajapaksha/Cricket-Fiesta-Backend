import { Router } from 'express';
import { prisma } from '../utils/prisma';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const teams = await prisma.team.findMany({
      include: {
        players: true,
        homeMatches: true,
        awayMatches: true,
        _count: {
          select: { players: true }
        }
      },
    });
    
    // Add computed fields
    const teamsWithStats = teams.map(team => ({
      ...team,
      playerCount: team._count.players,
      matchesPlayed: team.homeMatches.length + team.awayMatches.length,
      matchesWon: 0, // TODO: Calculate from match results
      matchesLost: 0,
    }));
    
    res.json({ status: 'success', data: teamsWithStats });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const team = await prisma.team.create({ data: req.body });
    res.status(201).json({ status: 'success', data: team });
  } catch (error) {
    next(error);
  }
});

// Auto-assign players to teams
router.post('/auto-assign', async (req, res, next) => {
  try {
    // Get all teams
    const teams = await prisma.team.findMany();
    
    if (teams.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'No teams found. Please create teams first.',
      });
    }
    
    // Get all unassigned players
    const unassignedPlayers = await prisma.player.findMany({
      where: { teamId: null },
    });
    
    if (unassignedPlayers.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'No unassigned players found.',
      });
    }
    
    // Shuffle players for random distribution
    const shuffledPlayers = [...unassignedPlayers].sort(() => Math.random() - 0.5);
    
    // Distribute players evenly across teams
    const assignments: { playerId: string; teamId: string }[] = [];
    shuffledPlayers.forEach((player, index) => {
      const teamIndex = index % teams.length;
      assignments.push({
        playerId: player.id,
        teamId: teams[teamIndex].id,
      });
    });
    
    // Update all players with their assigned teams
    for (const assignment of assignments) {
      await prisma.player.update({
        where: { id: assignment.playerId },
        data: { teamId: assignment.teamId },
      });
    }
    
    // Get updated team counts
    const updatedTeams = await prisma.team.findMany({
      include: {
        _count: { select: { players: true } },
      },
    });
    
    res.json({
      status: 'success',
      message: `Successfully assigned ${assignments.length} players to ${teams.length} teams`,
      data: {
        assignedCount: assignments.length,
        teams: updatedTeams.map(t => ({
          name: t.name,
          playerCount: t._count.players,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const team = await prisma.team.findUnique({
      where: { id: req.params.id },
      include: { players: true, homeMatches: true, awayMatches: true },
    });
    res.json({ status: 'success', data: team });
  } catch (error) {
    next(error);
  }
});

// Update team
router.patch('/:id', async (req, res, next) => {
  try {
    const team = await prisma.team.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json({ status: 'success', data: team });
  } catch (error) {
    next(error);
  }
});

// Delete team
router.delete('/:id', async (req, res, next) => {
  try {
    // First, unassign all players from this team
    await prisma.player.updateMany({
      where: { teamId: req.params.id },
      data: { teamId: null },
    });
    
    await prisma.team.delete({
      where: { id: req.params.id },
    });
    res.json({ status: 'success', message: 'Team deleted successfully' });
  } catch (error) {
    next(error);
  }
});

export default router;
