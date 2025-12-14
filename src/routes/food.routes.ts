import { Router } from 'express';
import { prisma } from '../utils/prisma';
import { generateQRCode } from '../utils/qrGenerator';
import { AppError } from '../middleware/errorHandler';
import { sendQRCodeEmail, sendFoodCollectionConfirmationEmail } from '../utils/emailService';
import { authenticate, requireSuperAdmin } from '../middleware/auth';

const router = Router();

// Get all food registrations
router.get('/registrations', async (req, res, next) => {
  try {
    const { department, foodPreference, foodCollected, traineeId, email } = req.query;
    
    const where: any = {};
    if (department) where.department = department;
    if (foodPreference) where.foodPreference = foodPreference;
    if (foodCollected !== undefined) where.foodCollected = foodCollected === 'true';
    if (traineeId) where.traineeId = { contains: traineeId as string, mode: 'insensitive' };
    if (email) where.email = { equals: email as string, mode: 'insensitive' };
    
    const registrations = await prisma.foodRegistration.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // Get all traineeIds to fetch user project names
    const traineeIds = registrations.map(r => r.traineeId);
    const users = await prisma.user.findMany({
      where: { traineeId: { in: traineeIds } },
      select: { traineeId: true, projectName: true }
    });
    const userMap = new Map(users.map(u => [u.traineeId, u.projectName]));

    // Add projectName to each registration
    const registrationsWithProject = registrations.map(reg => ({
      ...reg,
      projectName: userMap.get(reg.traineeId) || null
    }));
    
    res.json({ status: 'success', data: registrationsWithProject });
  } catch (error) {
    next(error);
  }
});

// Get food registration stats
router.get('/stats', async (req, res, next) => {
  try {
    const total = await prisma.foodRegistration.count();
    const collected = await prisma.foodRegistration.count({ where: { foodCollected: true } });
    const vegetarian = await prisma.foodRegistration.count({ where: { foodPreference: 'VEGETARIAN' } });
    const nonVegetarian = await prisma.foodRegistration.count({ where: { foodPreference: 'NON_VEGETARIAN' } });
    
    res.json({
      status: 'success',
      data: {
        total,
        collected,
        pending: total - collected,
        vegetarian,
        nonVegetarian,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get single food registration
router.get('/registrations/:id', async (req, res, next) => {
  try {
    const registration = await prisma.foodRegistration.findUnique({
      where: { id: req.params.id },
    });
    
    if (!registration) {
      throw new AppError('Registration not found', 404);
    }
    
    res.json({ status: 'success', data: registration });
  } catch (error) {
    next(error);
  }
});

// Create food registration
router.post('/registrations', async (req, res, next) => {
  try {
    const { traineeId, fullName, email, contactNumber, department, foodPreference } = req.body;
    
    const qrCode = await generateQRCode(traineeId);
    
    const registration = await prisma.foodRegistration.create({
      data: {
        traineeId,
        fullName,
        email,
        contactNumber,
        department,
        foodPreference,
        qrCode,
      },
    });
    
    res.status(201).json({ status: 'success', data: registration });
  } catch (error) {
    next(error);
  }
});

// Bulk import food registrations
router.post('/bulk-import', async (req, res, next) => {
  try {
    const { registrations, skipDuplicates = false } = req.body;
    
    if (!registrations || !Array.isArray(registrations)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid request: registrations array is required',
      });
    }
    
    const results = {
      imported: 0,
      failed: 0,
      skipped: 0,
      errors: [] as any[],
    };
    
    for (let i = 0; i < registrations.length; i++) {
      try {
        const data = registrations[i];
        const rowNum = data.rowNumber || i + 1;
        
        // Validate required fields
        const missingFields: string[] = [];
        if (!data.fullName) missingFields.push('Full Name');
        if (!data.traineeId) missingFields.push('Trainee ID');
        if (!data.contactNumber) missingFields.push('Contact Number');
        if (!data.department) missingFields.push('Department');
        if (!data.foodPreference) missingFields.push('Food Preference');
        
        if (missingFields.length > 0) {
          results.failed++;
          results.errors.push({
            rowNumber: rowNum,
            error: `Missing required fields: ${missingFields.join(', ')}`,
          });
          continue;
        }
        
        // Check for duplicate
        const existing = await prisma.foodRegistration.findUnique({
          where: { traineeId: data.traineeId },
        });
        
        if (existing) {
          if (skipDuplicates) {
            results.skipped++;
            continue;
          } else {
            results.failed++;
            results.errors.push({
              rowNumber: rowNum,
              error: `Trainee ID ${data.traineeId} already registered`,
            });
            continue;
          }
        }
        
        // Generate QR code
        const qrCode = await generateQRCode(data.traineeId);
        
        // Create registration
        await prisma.foodRegistration.create({
          data: {
            traineeId: data.traineeId,
            fullName: data.fullName,
            email: data.email || null,
            contactNumber: data.contactNumber,
            department: data.department,
            foodPreference: data.foodPreference,
            qrCode,
          },
        });
        
        results.imported++;
      } catch (error: any) {
        results.failed++;
        results.errors.push({
          rowNumber: registrations[i]?.rowNumber || i + 1,
          error: error.message || 'Unknown error',
        });
      }
    }
    
    res.status(200).json({ status: 'success', data: results });
  } catch (error) {
    next(error);
  }
});

// Lookup person by traineeId - checks both FoodRegistration and Player tables
router.get('/lookup/:traineeId', async (req, res, next) => {
  try {
    const { traineeId } = req.params;
    
    // First check FoodRegistration table
    let registration = await prisma.foodRegistration.findUnique({
      where: { traineeId },
    });
    
    // If not found in FoodRegistration, check Player table
    if (!registration) {
      const player = await prisma.player.findUnique({
        where: { traineeId },
        include: { team: true }
      });
      
      if (!player) {
        throw new AppError('No registration found for this ID', 404);
      }
      
      // Check if player already has a food registration record
      const existingFoodReg = await prisma.foodRegistration.findFirst({
        where: { traineeId: player.traineeId }
      });
      
      if (existingFoodReg) {
        registration = existingFoodReg;
      } else {
        // Return player info for display, will create food registration when collecting
        return res.json({
          status: 'success',
          data: {
            id: player.id,
            traineeId: player.traineeId,
            fullName: player.fullName,
            email: player.email,
            department: player.department,
            foodPreference: 'NON_VEGETARIAN', // Default for players
            foodCollected: false,
            foodCollectedAt: null,
            isPlayer: true, // Flag to indicate this is from Player table
            team: player.team?.name || null
          }
        });
      }
    }
    
    res.json({ status: 'success', data: registration });
  } catch (error) {
    next(error);
  }
});

// Mark food as collected by ID
router.post('/registrations/:id/collect', async (req, res, next) => {
  try {
    const registration = await prisma.foodRegistration.findUnique({
      where: { id: req.params.id },
    });
    
    if (!registration) {
      throw new AppError('Registration not found', 404);
    }
    
    if (registration.foodCollected) {
      throw new AppError('Food already collected', 400);
    }
    
    const collectedAt = new Date();
    const updated = await prisma.foodRegistration.update({
      where: { id: req.params.id },
      data: {
        foodCollected: true,
        foodCollectedAt: collectedAt,
      },
    });
    
    // Send confirmation email (don't await - fire and forget)
    if (registration.email) {
      sendFoodCollectionConfirmationEmail({
        to: registration.email,
        name: registration.fullName,
        traineeId: registration.traineeId,
        department: registration.department,
        foodPreference: registration.foodPreference,
        collectedAt,
      }).catch(() => {}); // Silently handle email errors
    }
    
    res.json({ status: 'success', data: updated });
  } catch (error) {
    next(error);
  }
});

// Mark food as collected by traineeId - handles both players and trainees
router.post('/collect-by-trainee/:traineeId', async (req, res, next) => {
  try {
    const { traineeId } = req.params;
    
    // First check FoodRegistration table
    let registration = await prisma.foodRegistration.findUnique({
      where: { traineeId },
    });
    
    // If not found in FoodRegistration, check Player table and create registration
    if (!registration) {
      const player = await prisma.player.findUnique({
        where: { traineeId },
      });
      
      if (!player) {
        throw new AppError('No registration found for this ID', 404);
      }
      
      // Create a food registration record for the player on-the-fly
      registration = await prisma.foodRegistration.create({
        data: {
          traineeId: player.traineeId,
          fullName: player.fullName,
          email: player.email,
          contactNumber: player.contactNumber,
          department: player.department,
          foodPreference: 'NON_VEGETARIAN', // Default preference for players
          qrCode: player.qrCode,
          foodCollected: false,
        }
      });
    }
    
    if (registration.foodCollected) {
      throw new AppError('Food already collected', 400);
    }
    
    const collectedAt = new Date();
    const updated = await prisma.foodRegistration.update({
      where: { traineeId },
      data: {
        foodCollected: true,
        foodCollectedAt: collectedAt,
      },
    });
    
    // Send confirmation email (don't await - fire and forget)
    if (registration.email) {
      sendFoodCollectionConfirmationEmail({
        to: registration.email,
        name: registration.fullName,
        traineeId: registration.traineeId,
        department: registration.department,
        foodPreference: registration.foodPreference,
        collectedAt,
      }).catch(() => {}); // Silently handle email errors
    }
    
    res.json({ status: 'success', message: 'Food collected successfully', data: updated });
  } catch (error) {
    next(error);
  }
});

// Scan QR code for food collection
router.post('/scan', async (req, res, next) => {
  try {
    const { traineeId } = req.body;
    
    if (!traineeId) {
      throw new AppError('Trainee ID is required', 400);
    }
    
    // First check FoodRegistration table
    let registration = await prisma.foodRegistration.findUnique({
      where: { traineeId },
    });
    
    // If not found in FoodRegistration, check Player table
    if (!registration) {
      const player = await prisma.player.findUnique({
        where: { traineeId },
      });
      
      if (!player) {
        throw new AppError('Registration not found', 404);
      }
      
      // Check if player already has a food registration record
      const existingFoodReg = await prisma.foodRegistration.findFirst({
        where: { traineeId: player.traineeId }
      });
      
      if (existingFoodReg) {
        registration = existingFoodReg;
      } else {
        // Create a food registration record for the player on-the-fly
        registration = await prisma.foodRegistration.create({
          data: {
            traineeId: player.traineeId,
            fullName: player.fullName,
            email: player.email,
            contactNumber: player.contactNumber,
            department: player.department,
            foodPreference: 'NON_VEGETARIAN', // Default preference for players
            qrCode: player.qrCode,
            foodCollected: false,
          }
        });
      }
    }
    
    if (registration.foodCollected) {
      throw new AppError('Food already collected', 400);
    }
    
    const collectedAt = new Date();
    const updated = await prisma.foodRegistration.update({
      where: { traineeId },
      data: {
        foodCollected: true,
        foodCollectedAt: collectedAt,
      },
    });
    
    // Send confirmation email (don't await - fire and forget)
    if (registration.email) {
      sendFoodCollectionConfirmationEmail({
        to: registration.email,
        name: registration.fullName,
        traineeId: registration.traineeId,
        department: registration.department,
        foodPreference: registration.foodPreference,
        collectedAt,
      }).catch(() => {}); // Silently handle email errors
    }
    
    res.json({
      status: 'success',
      message: 'Food collected successfully',
      data: updated,
    });
  } catch (error) {
    next(error);
  }
});

// Delete food registration
router.delete('/registrations/:id', async (req, res, next) => {
  try {
    await prisma.foodRegistration.delete({
      where: { id: req.params.id },
    });
    
    res.json({ status: 'success', message: 'Registration deleted' });
  } catch (error) {
    next(error);
  }
});

// Food counter routes (existing)
router.get('/counters', async (req, res, next) => {
  try {
    const counters = await prisma.foodCounter.findMany();
    res.json({ status: 'success', data: counters });
  } catch (error) {
    next(error);
  }
});

router.patch('/queue/:counterName', async (req, res, next) => {
  try {
    const counter = await prisma.foodCounter.update({
      where: { counterName: req.params.counterName },
      data: req.body,
    });
    res.json({ status: 'success', data: counter });
  } catch (error) {
    next(error);
  }
});

// Send QR code email to a single registration
router.post('/registrations/:id/send-email', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const registration = await prisma.foodRegistration.findUnique({
      where: { id: req.params.id },
    });

    if (!registration) {
      throw new AppError('Registration not found', 404);
    }

    if (!registration.email) {
      throw new AppError('No email address associated with this registration', 400);
    }

    if (!registration.qrCode) {
      throw new AppError('No QR code generated for this registration', 400);
    }

    await sendQRCodeEmail({
      to: registration.email,
      name: registration.fullName,
      traineeId: registration.traineeId,
      qrCode: registration.qrCode,
      department: registration.department,
      foodPreference: registration.foodPreference,
    });

    res.json({ 
      status: 'success', 
      message: `QR code sent successfully to ${registration.email}` 
    });
  } catch (error) {
    next(error);
  }
});

// Send QR code emails to all registrations (bulk send)
router.post('/send-emails-bulk', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { registrationIds } = req.body; // Optional: send to specific IDs only
    
    let registrations;
    
    if (registrationIds && Array.isArray(registrationIds) && registrationIds.length > 0) {
      // Send to specific registrations
      registrations = await prisma.foodRegistration.findMany({
        where: {
          id: { in: registrationIds },
          email: { not: '' },
          qrCode: { not: '' },
        },
      });
      // Filter out any null emails/qrCodes
      registrations = registrations.filter(r => r.email && r.qrCode);
    } else {
      // Send to all registrations with email
      registrations = await prisma.foodRegistration.findMany({
        where: {
          email: { not: '' },
          qrCode: { not: '' },
        },
      });
      // Filter out any null emails/qrCodes
      registrations = registrations.filter(r => r.email && r.qrCode);
    }

    if (registrations.length === 0) {
      throw new AppError('No valid registrations found to send emails', 400);
    }

    const results = {
      total: registrations.length,
      sent: 0,
      failed: 0,
      errors: [] as { traineeId: string; email: string; error: string }[],
    };

    // Send emails in batches to avoid overwhelming the SMTP server
    const BATCH_SIZE = 10;
    const DELAY_BETWEEN_BATCHES = 2000; // 2 seconds

    for (let i = 0; i < registrations.length; i += BATCH_SIZE) {
      const batch = registrations.slice(i, i + BATCH_SIZE);
      
      const promises = batch.map(async (registration) => {
        try {
          await sendQRCodeEmail({
            to: registration.email!,
            name: registration.fullName,
            traineeId: registration.traineeId,
            qrCode: registration.qrCode!,
            department: registration.department,
            foodPreference: registration.foodPreference,
          });
          results.sent++;
        } catch (error: any) {
          results.failed++;
          results.errors.push({
            traineeId: registration.traineeId,
            email: registration.email || 'N/A',
            error: error.message || 'Unknown error',
          });
        }
      });

      await Promise.all(promises);
      
      // Add delay between batches (except for last batch)
      if (i + BATCH_SIZE < registrations.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }

    res.json({
      status: 'success',
      message: `Emails sent: ${results.sent}/${results.total}`,
      data: results,
    });
  } catch (error) {
    next(error);
  }
});

// Get email status/stats
router.get('/email-stats', authenticate, async (req, res, next) => {
  try {
    const totalWithEmail = await prisma.foodRegistration.count({
      where: { email: { not: null } },
    });
    
    const totalWithoutEmail = await prisma.foodRegistration.count({
      where: { email: null },
    });
    
    // Count all and subtract nulls for accurate count
    const totalRegistrations = await prisma.foodRegistration.count();
    const registrationsWithoutQR = await prisma.foodRegistration.count({
      where: { qrCode: '' },
    });
    const allRegs = await prisma.foodRegistration.findMany({ select: { qrCode: true } });
    const totalWithQR = allRegs.filter(r => r.qrCode && r.qrCode !== '').length;

    res.json({
      status: 'success',
      data: {
        totalWithEmail,
        totalWithoutEmail,
        totalWithQR,
        canSendEmails: totalWithEmail,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
