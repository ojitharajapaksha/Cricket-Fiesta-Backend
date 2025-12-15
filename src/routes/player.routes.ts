import { Router } from 'express';
import { prisma } from '../utils/prisma';
import { generateQRCode, generatePlayerId } from '../utils/qrGenerator';
import { AppError } from '../middleware/errorHandler';
import { authenticate, requireAdmin, requireUser } from '../middleware/auth';
import { io } from '../index';

const router = Router();

// Get public players list (for public Players page - no auth required)
// Only shows players approved by super admin
router.get('/public', async (req, res, next) => {
  try {
    const players = await prisma.player.findMany({
      where: {
        isApproved: true  // Only show approved players on public page
      },
      select: {
        id: true,
        fullName: true,
        department: true,
        position: true,
        battingStyle: true,
        bowlingStyle: true,
        experienceLevel: true,
        profileImage: true,
        team: {
          select: {
            id: true,
            name: true,
          }
        },
        user: {
          select: {
            projectName: true,
          }
        }
      },
      orderBy: [
        { team: { name: 'asc' } },
        { fullName: 'asc' }
      ]
    });

    // Map players to include projectName at top level
    const playersWithProject = players.map(player => ({
      id: player.id,
      fullName: player.fullName,
      department: player.department,
      position: player.position,
      battingStyle: player.battingStyle,
      bowlingStyle: player.bowlingStyle,
      experienceLevel: player.experienceLevel,
      profileImage: player.profileImage,
      projectName: player.user?.projectName || null,
      team: player.team
    }));

    res.json({ status: 'success', data: playersWithProject });
  } catch (error) { 
    next(error); 
  }
});

// Get all players - accessible by all authenticated users
router.get('/', authenticate, requireUser, async (req, res, next) => {
  try {
    const { department, position, teamId, attended, email } = req.query;

    const where: any = {};
    if (department) where.department = department as string;
    if (position) where.position = position as string;
    if (teamId) where.teamId = teamId as string;
    if (attended !== undefined) where.attended = attended === 'true';
    if (email) where.email = { equals: email as string, mode: 'insensitive' };

    const players = await prisma.player.findMany({
      where,
      include: {
        team: true,
        user: {
          select: {
            id: true,
            projectName: true,
          }
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Get food registration data for each player based on traineeId
    const traineeIds = players.map(p => p.traineeId);
    const foodRegistrations = await prisma.foodRegistration.findMany({
      where: {
        traineeId: { in: traineeIds }
      }
    });

    // Create a map for quick lookup
    const foodRegMap = new Map(foodRegistrations.map(f => [f.traineeId, f]));

    // Combine player data with food registration and project name
    const playersWithFood = players.map(player => {
      const foodReg = foodRegMap.get(player.traineeId);
      return {
        ...player,
        projectName: player.user?.projectName || null,
        isApproved: player.isApproved,
        foodRegistration: foodReg ? {
          id: foodReg.id,
          foodPreference: foodReg.foodPreference,
          foodCollected: foodReg.foodCollected,
          foodCollectedAt: foodReg.foodCollectedAt,
        } : null
      };
    });

    res.json({
      status: 'success',
      data: playersWithFood,
      count: playersWithFood.length,
    });
  } catch (error) {
    next(error);
  }
});

// Get player by ID
router.get('/:id', async (req, res, next) => {
  try {
    const player = await prisma.player.findUnique({
      where: { id: req.params.id },
      include: {
        team: true,
        matchPerformances: {
          include: {
            match: true,
          },
        },
        awards: true,
      },
    });

    if (!player) {
      throw new AppError('Player not found', 404);
    }

    res.json({
      status: 'success',
      data: player,
    });
  } catch (error) {
    next(error);
  }
});

// Create new player (Admin only)
router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const {
      fullName,
      gender,
      contactNumber,
      emergencyContact,
      email,
      department,
      position,
      battingStyle,
      bowlingStyle,
      experienceLevel,
    } = req.body;

    // Generate unique trainee ID
    const traineeId = generatePlayerId(fullName, department);

    // Generate QR code
    const qrCode = await generateQRCode(traineeId);

    const player = await prisma.player.create({
      data: {
        traineeId,
        fullName,
        gender,
        contactNumber,
        emergencyContact,
        email,
        department,
        position,
        battingStyle,
        bowlingStyle,
        experienceLevel,
        qrCode,
      },
    });

    // Broadcast real-time update
    // io.emit('player:registration', player);

    // Track analytics
    await prisma.analytics.create({
      data: {
        event: 'player_registered',
        category: 'registration',
        data: { playerId: player.id, department },
      },
    });

    res.status(201).json({
      status: 'success',
      data: player,
    });
  } catch (error) {
    next(error);
  }
});

// Update player
router.patch('/:id', async (req, res, next) => {
  try {
    const player = await prisma.player.update({
      where: { id: req.params.id },
      data: req.body,
    });

    res.json({
      status: 'success',
      data: player,
    });
  } catch (error) {
    next(error);
  }
});

// Mark attendance
router.post('/:id/attendance', async (req, res, next) => {
  try {
    const player = await prisma.player.update({
      where: { id: req.params.id },
      data: {
        attended: true,
        attendedAt: new Date(),
      },
    });

    // Broadcast attendance update
    // io.emit('attendance:update', { playerId: player.id, attended: true });

    res.json({
      status: 'success',
      data: player,
    });
  } catch (error) {
    next(error);
  }
});

// Scan QR code for attendance only (food scanning moved to /api/food/scan)
router.post('/scan', async (req, res, next) => {
  try {
    const { traineeId } = req.body;

    const player = await prisma.player.findUnique({
      where: { traineeId },
    });

    if (!player) {
      throw new AppError('Player not found', 404);
    }

    if (player.attended) {
      throw new AppError('Already marked attendance', 400);
    }

    const updated = await prisma.player.update({
      where: { traineeId },
      data: {
        attended: true,
        attendedAt: new Date(),
      },
    });

    return res.json({
      status: 'success',
      message: 'Attendance marked successfully',
      data: updated,
    });
  } catch (error) {
    next(error);
  }
});

// Bulk import players
router.post('/bulk-import', async (req, res, next) => {
  try {
    const { players, skipDuplicates = false } = req.body;

    if (!players || !Array.isArray(players)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid request: players array is required',
      });
    }

    const results = {
      imported: 0,
      failed: 0,
      skipped: 0,
      errors: [] as any[],
    };

    for (let i = 0; i < players.length; i++) {
      try {
        const playerData = players[i];
        const rowNum = playerData.rowNumber || i + 1;

        // Validate required fields from Google Form
        const missingFields: string[] = [];
        if (!playerData.fullName) missingFields.push('Full Name');
        if (!playerData.traineeId) missingFields.push('Trainee ID');
        if (!playerData.contactNumber) missingFields.push('Contact Number');
        if (!playerData.department) missingFields.push('Department');

        if (missingFields.length > 0) {
          results.failed++;
          results.errors.push({
            rowNumber: rowNum,
            error: `Missing required fields: ${missingFields.join(', ')}`,
            data: playerData,
          });
          continue;
        }

        // Check if trainee ID already exists
        const existingPlayer = await prisma.player.findUnique({
          where: { traineeId: playerData.traineeId },
        });

        if (existingPlayer) {
          if (skipDuplicates) {
            // Silently skip duplicates
            results.skipped++;
            continue;
          } else {
            results.failed++;
            results.errors.push({
              rowNumber: rowNum,
              error: `Player with Trainee ID ${playerData.traineeId} already exists`,
              data: playerData,
            });
            continue;
          }
        }

        // Generate QR code for the trainee
        const qrCode = await generateQRCode(playerData.traineeId);

        // Create player with validated data
        await prisma.player.create({
          data: {
            traineeId: playerData.traineeId,
            fullName: playerData.fullName,
            email: playerData.email || null,
            contactNumber: playerData.contactNumber,
            department: playerData.department,
            gender: playerData.gender || 'MALE',
            position: playerData.position || 'BATSMAN',
            experienceLevel: playerData.experienceLevel || 'BEGINNER',
            emergencyContact: playerData.emergencyContact || null,
            battingStyle: playerData.battingStyle || null,
            bowlingStyle: playerData.bowlingStyle || null,
            qrCode,
          },
        });

        results.imported++;
      } catch (error: any) {
        results.failed++;
        results.errors.push({
          rowNumber: players[i]?.rowNumber || i + 1,
          error: error.message || 'Unknown error',
          data: players[i],
        });
      }
    }

    res.status(200).json({
      status: 'success',
      data: results,
    });
  } catch (error) {
    next(error);
  }
});

// Delete player
router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.player.delete({
      where: { id: req.params.id },
    });

    res.json({
      status: 'success',
      message: 'Player deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

// Get player statistics
router.get('/:id/stats', async (req, res, next) => {
  try {
    const player = await prisma.player.findUnique({
      where: { id: req.params.id },
      include: {
        matchPerformances: {
          include: {
            match: true,
          },
        },
        awards: true,
      },
    });

    if (!player) {
      throw new AppError('Player not found', 404);
    }

    const stats = {
      totalMatches: player.matchPerformances.length,
      totalRuns: player.matchPerformances.reduce((sum, p) => sum + p.runs, 0),
      totalWickets: player.matchPerformances.reduce((sum, p) => sum + p.wickets, 0),
      bestScore: Math.max(...player.matchPerformances.map(p => p.runs)),
      bestBowling: Math.max(...player.matchPerformances.map(p => p.wickets)),
      awards: player.awards.length,
    };

    res.json({
      status: 'success',
      data: stats,
    });
  } catch (error) {
    next(error);
  }
});

// Update player profile image by email (for logged in users)
router.put('/profile-image', authenticate, requireUser, async (req, res, next) => {
  try {
    const { email, profileImage } = req.body;
    
    if (!email || !profileImage) {
      throw new AppError('Email and profile image URL are required', 400);
    }
    
    // Find player by email
    const player = await prisma.player.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } }
    });
    
    if (!player) {
      throw new AppError('Player not found', 404);
    }
    
    // Update profile image
    const updated = await prisma.player.update({
      where: { id: player.id },
      data: { profileImage }
    });
    
    res.json({
      status: 'success',
      message: 'Profile image updated successfully',
      data: updated
    });
  } catch (error) {
    next(error);
  }
});

// Toggle player approval status for public page visibility (Super Admin only)
router.put('/:id/approval', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isApproved } = req.body;
    
    if (typeof isApproved !== 'boolean') {
      throw new AppError('isApproved must be a boolean', 400);
    }
    
    const player = await prisma.player.findUnique({ where: { id } });
    if (!player) {
      throw new AppError('Player not found', 404);
    }
    
    const updated = await prisma.player.update({
      where: { id },
      data: { isApproved }
    });
    
    res.json({
      status: 'success',
      message: `Player ${isApproved ? 'approved' : 'unapproved'} for public page`,
      data: updated
    });
  } catch (error) {
    next(error);
  }
});

// Bulk approve/unapprove players (Super Admin only)
router.put('/bulk-approval', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { playerIds, isApproved } = req.body;
    
    if (!Array.isArray(playerIds) || playerIds.length === 0) {
      throw new AppError('playerIds must be a non-empty array', 400);
    }
    
    if (typeof isApproved !== 'boolean') {
      throw new AppError('isApproved must be a boolean', 400);
    }
    
    const result = await prisma.player.updateMany({
      where: { id: { in: playerIds } },
      data: { isApproved }
    });
    
    res.json({
      status: 'success',
      message: `${result.count} players ${isApproved ? 'approved' : 'unapproved'} for public page`,
      data: { count: result.count }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
