import { Router } from 'express';
import { prisma } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { authenticate, requireSuperAdmin } from '../middleware/auth';

const router = Router();

// Get all tournaments
router.get('/', authenticate, async (req, res, next) => {
  try {
    const tournaments = await prisma.tournament.findMany({
      include: {
        matches: {
          include: {
            homeTeam: true,
            awayTeam: true
          }
        },
        standings: {
          include: {
            team: true
          },
          orderBy: [
            { points: 'desc' },
            { netRunRate: 'desc' }
          ]
        }
      },
      orderBy: { startDate: 'desc' }
    });

    res.json({
      status: 'success',
      data: tournaments
    });
  } catch (error) {
    next(error);
  }
});

// Get single tournament
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const tournament = await prisma.tournament.findUnique({
      where: { id: req.params.id },
      include: {
        matches: {
          include: {
            homeTeam: true,
            awayTeam: true
          },
          orderBy: { scheduledTime: 'asc' }
        },
        standings: {
          include: {
            team: true
          },
          orderBy: [
            { points: 'desc' },
            { netRunRate: 'desc' }
          ]
        }
      }
    });

    if (!tournament) {
      throw new AppError('Tournament not found', 404);
    }

    res.json({
      status: 'success',
      data: tournament
    });
  } catch (error) {
    next(error);
  }
});

// Create tournament
router.post('/', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const {
      name,
      description,
      type,
      format,
      startDate,
      endDate,
      numberOfTeams,
      maxPlayersPerTeam,
      minPlayersPerTeam,
      entryFee,
      prizePool,
      rules
    } = req.body;

    if (!name || !type || !format || !startDate || !endDate || !numberOfTeams) {
      throw new AppError('Name, type, format, dates, and number of teams are required', 400);
    }

    const tournament = await prisma.tournament.create({
      data: {
        name,
        description,
        type,
        format,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        numberOfTeams: parseInt(numberOfTeams),
        maxPlayersPerTeam: maxPlayersPerTeam ? parseInt(maxPlayersPerTeam) : 11,
        minPlayersPerTeam: minPlayersPerTeam ? parseInt(minPlayersPerTeam) : 8,
        entryFee: entryFee ? parseFloat(entryFee) : null,
        prizePool: prizePool ? parseFloat(prizePool) : null,
        rules,
        createdBy: req.user!.userId,
        status: 'UPCOMING'
      }
    });

    res.status(201).json({
      status: 'success',
      data: tournament
    });
  } catch (error) {
    next(error);
  }
});

// Update tournament
router.put('/:id', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const {
      name,
      description,
      type,
      format,
      startDate,
      endDate,
      numberOfTeams,
      maxPlayersPerTeam,
      minPlayersPerTeam,
      entryFee,
      prizePool,
      rules,
      status
    } = req.body;

    const updateData: any = {};
    if (name) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (type) updateData.type = type;
    if (format) updateData.format = format;
    if (startDate) updateData.startDate = new Date(startDate);
    if (endDate) updateData.endDate = new Date(endDate);
    if (numberOfTeams) updateData.numberOfTeams = parseInt(numberOfTeams);
    if (maxPlayersPerTeam) updateData.maxPlayersPerTeam = parseInt(maxPlayersPerTeam);
    if (minPlayersPerTeam) updateData.minPlayersPerTeam = parseInt(minPlayersPerTeam);
    if (entryFee !== undefined) updateData.entryFee = entryFee ? parseFloat(entryFee) : null;
    if (prizePool !== undefined) updateData.prizePool = prizePool ? parseFloat(prizePool) : null;
    if (rules !== undefined) updateData.rules = rules;
    if (status) updateData.status = status;

    const tournament = await prisma.tournament.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        matches: true,
        standings: true
      }
    });

    res.json({
      status: 'success',
      data: tournament
    });
  } catch (error) {
    next(error);
  }
});

// Delete tournament
router.delete('/:id', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    await prisma.tournament.delete({
      where: { id: req.params.id }
    });

    res.json({
      status: 'success',
      message: 'Tournament deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

// Add team to tournament
router.post('/:id/teams', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { teamId } = req.body;

    if (!teamId) {
      throw new AppError('Team ID is required', 400);
    }

    const tournament = await prisma.tournament.findUnique({
      where: { id: req.params.id },
      include: { standings: true }
    });

    if (!tournament) {
      throw new AppError('Tournament not found', 404);
    }

    if (tournament.standings.length >= tournament.numberOfTeams) {
      throw new AppError('Tournament is already full', 400);
    }

    // Check if team already added
    const existing = tournament.standings.find((s: any) => s.teamId === teamId);
    if (existing) {
      throw new AppError('Team already added to tournament', 400);
    }

    const standing = await prisma.tournamentStanding.create({
      data: {
        tournamentId: req.params.id,
        teamId
      },
      include: {
        team: true
      }
    });

    res.status(201).json({
      status: 'success',
      data: standing
    });
  } catch (error) {
    next(error);
  }
});

// Remove team from tournament
router.delete('/:id/teams/:teamId', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    await prisma.tournamentStanding.deleteMany({
      where: {
        tournamentId: req.params.id,
        teamId: req.params.teamId
      }
    });

    res.json({
      status: 'success',
      message: 'Team removed from tournament'
    });
  } catch (error) {
    next(error);
  }
});

// Generate matches for tournament
router.post('/:id/generate-matches', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { venue, startTime, matchInterval } = req.body;

    const tournament = await prisma.tournament.findUnique({
      where: { id: req.params.id },
      include: {
        standings: {
          include: { team: true }
        }
      }
    });

    if (!tournament) {
      throw new AppError('Tournament not found', 404);
    }

    if (tournament.standings.length < 2) {
      throw new AppError('At least 2 teams required to generate matches', 400);
    }

    const teams = tournament.standings.map((s: any) => s.team);
    const matches = [];

    if (tournament.type === 'LEAGUE' || tournament.type === 'ROUND_ROBIN') {
      // Generate round-robin matches
      for (let i = 0; i < teams.length; i++) {
        for (let j = i + 1; j < teams.length; j++) {
          matches.push({
            homeTeamId: teams[i].id,
            awayTeamId: teams[j].id
          });
        }
      }
    } else if (tournament.type === 'KNOCKOUT') {
      // Generate knockout rounds
      const rounds = Math.ceil(Math.log2(teams.length));
      for (let i = 0; i < teams.length; i += 2) {
        if (i + 1 < teams.length) {
          matches.push({
            homeTeamId: teams[i].id,
            awayTeamId: teams[i + 1].id,
            round: rounds === 1 ? 'Final' : rounds === 2 ? 'Semi Final' : rounds === 3 ? 'Quarter Final' : `Round of ${Math.pow(2, rounds)}`
          });
        }
      }
    }

    // Create matches with scheduled times
    const baseTime = startTime ? new Date(startTime) : new Date(tournament.startDate);
    const interval = matchInterval || 180; // 3 hours default

    let matchNumber = await prisma.match.count() + 1;
    const createdMatches = [];

    for (let i = 0; i < matches.length; i++) {
      const scheduledTime = new Date(baseTime.getTime() + i * interval * 60000);
      
      const match = await prisma.match.create({
        data: {
          matchNumber,
          matchType: tournament.format,
          tournamentId: tournament.id,
          homeTeamId: matches[i].homeTeamId,
          awayTeamId: matches[i].awayTeamId,
          scheduledTime,
          venue: venue || 'TBD',
          overs: tournament.format === 'T10' ? 10 : tournament.format === 'T15' ? 15 : 20,
          round: matches[i].round
        },
        include: {
          homeTeam: true,
          awayTeam: true
        }
      });

      createdMatches.push(match);
      matchNumber++;
    }

    res.status(201).json({
      status: 'success',
      message: `Generated ${createdMatches.length} matches`,
      data: createdMatches
    });
  } catch (error) {
    next(error);
  }
});

// Update standings after match
router.post('/:id/update-standings', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { matchId } = req.body;

    const match = await prisma.match.findUnique({
      where: { id: matchId }
    });

    if (!match || !match.winnerId || match.status !== 'COMPLETED') {
      throw new AppError('Match not completed or no winner', 400);
    }

    // Update winner standing
    const winnerStanding = await prisma.tournamentStanding.findFirst({
      where: {
        tournamentId: req.params.id,
        teamId: match.winnerId
      }
    });

    if (winnerStanding) {
      await prisma.tournamentStanding.update({
        where: { id: winnerStanding.id },
        data: {
          matchesPlayed: { increment: 1 },
          wins: { increment: 1 },
          points: { increment: 2 }
        }
      });
    }

    // Update loser standing
    const loserId = match.homeTeamId === match.winnerId ? match.awayTeamId : match.homeTeamId;
    const loserStanding = await prisma.tournamentStanding.findFirst({
      where: {
        tournamentId: req.params.id,
        teamId: loserId
      }
    });

    if (loserStanding) {
      await prisma.tournamentStanding.update({
        where: { id: loserStanding.id },
        data: {
          matchesPlayed: { increment: 1 },
          losses: { increment: 1 }
        }
      });
    }

    const updatedStandings = await prisma.tournamentStanding.findMany({
      where: { tournamentId: req.params.id },
      include: { team: true },
      orderBy: [
        { points: 'desc' },
        { netRunRate: 'desc' }
      ]
    });

    res.json({
      status: 'success',
      data: updatedStandings
    });
  } catch (error) {
    next(error);
  }
});

export default router;
