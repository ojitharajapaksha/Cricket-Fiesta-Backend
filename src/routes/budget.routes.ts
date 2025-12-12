import { Router } from 'express';
import { prisma } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { authenticate, requireSuperAdmin } from '../middleware/auth';

const router = Router();

// Get all budgets with expenses
router.get('/', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const budgets = await prisma.budget.findMany({
      include: {
        expenses: {
          orderBy: { paidDate: 'desc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Calculate remaining for each budget
    const budgetsWithCalculated = budgets.map(budget => ({
      ...budget,
      remaining: budget.allocated - budget.spent
    }));

    res.json({
      status: 'success',
      data: budgetsWithCalculated,
      summary: {
        totalAllocated: budgets.reduce((sum, b) => sum + b.allocated, 0),
        totalSpent: budgets.reduce((sum, b) => sum + b.spent, 0),
        totalRemaining: budgets.reduce((sum, b) => sum + (b.allocated - b.spent), 0)
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get single budget
router.get('/:id', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const budget = await prisma.budget.findUnique({
      where: { id: req.params.id },
      include: {
        expenses: {
          orderBy: { paidDate: 'desc' }
        }
      }
    });

    if (!budget) {
      throw new AppError('Budget not found', 404);
    }

    res.json({
      status: 'success',
      data: {
        ...budget,
        remaining: budget.allocated - budget.spent
      }
    });
  } catch (error) {
    next(error);
  }
});

// Create new budget
router.post('/', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { category, description, allocated } = req.body;

    if (!category || !allocated) {
      throw new AppError('Category and allocated amount are required', 400);
    }

    if (allocated <= 0) {
      throw new AppError('Allocated amount must be greater than 0', 400);
    }

    const budget = await prisma.budget.create({
      data: {
        category,
        description,
        allocated: parseFloat(allocated),
        spent: 0,
        remaining: parseFloat(allocated),
        createdBy: req.user!.userId,
        status: 'ACTIVE'
      }
    });

    res.status(201).json({
      status: 'success',
      data: budget
    });
  } catch (error) {
    next(error);
  }
});

// Update budget
router.put('/:id', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { category, description, allocated, status } = req.body;

    const existingBudget = await prisma.budget.findUnique({
      where: { id: req.params.id }
    });

    if (!existingBudget) {
      throw new AppError('Budget not found', 404);
    }

    const updateData: any = {};
    if (category) updateData.category = category;
    if (description !== undefined) updateData.description = description;
    if (status) updateData.status = status;
    if (allocated) {
      updateData.allocated = parseFloat(allocated);
      updateData.remaining = parseFloat(allocated) - existingBudget.spent;
    }

    const budget = await prisma.budget.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        expenses: true
      }
    });

    res.json({
      status: 'success',
      data: budget
    });
  } catch (error) {
    next(error);
  }
});

// Delete budget
router.delete('/:id', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    await prisma.budget.delete({
      where: { id: req.params.id }
    });

    res.json({
      status: 'success',
      message: 'Budget deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

// Add expense to budget
router.post('/:id/expenses', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { description, amount, receipt, paidBy, paidDate } = req.body;

    if (!description || !amount || !paidBy || !paidDate) {
      throw new AppError('Description, amount, paidBy, and paidDate are required', 400);
    }

    const budget = await prisma.budget.findUnique({
      where: { id: req.params.id }
    });

    if (!budget) {
      throw new AppError('Budget not found', 404);
    }

    const expenseAmount = parseFloat(amount);
    const newSpent = budget.spent + expenseAmount;
    const newRemaining = budget.allocated - newSpent;

    // Create expense
    const expense = await prisma.budgetExpense.create({
      data: {
        budgetId: req.params.id,
        description,
        amount: expenseAmount,
        receipt,
        paidBy,
        paidDate: new Date(paidDate),
        approvedBy: req.user!.userId
      }
    });

    // Update budget spent and status
    const updatedBudget = await prisma.budget.update({
      where: { id: req.params.id },
      data: {
        spent: newSpent,
        remaining: newRemaining,
        status: newRemaining < 0 ? 'EXCEEDED' : budget.status
      },
      include: {
        expenses: {
          orderBy: { paidDate: 'desc' }
        }
      }
    });

    res.status(201).json({
      status: 'success',
      data: {
        expense,
        budget: updatedBudget
      }
    });
  } catch (error) {
    next(error);
  }
});

// Update expense
router.put('/:budgetId/expenses/:expenseId', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { description, amount, receipt, paidBy, paidDate } = req.body;

    const existingExpense = await prisma.budgetExpense.findUnique({
      where: { id: req.params.expenseId }
    });

    if (!existingExpense) {
      throw new AppError('Expense not found', 404);
    }

    const updateData: any = {};
    if (description) updateData.description = description;
    if (receipt !== undefined) updateData.receipt = receipt;
    if (paidBy) updateData.paidBy = paidBy;
    if (paidDate) updateData.paidDate = new Date(paidDate);

    // If amount changed, recalculate budget
    if (amount && parseFloat(amount) !== existingExpense.amount) {
      const budget = await prisma.budget.findUnique({
        where: { id: req.params.budgetId }
      });

      if (budget) {
        const amountDiff = parseFloat(amount) - existingExpense.amount;
        const newSpent = budget.spent + amountDiff;
        const newRemaining = budget.allocated - newSpent;

        await prisma.budget.update({
          where: { id: req.params.budgetId },
          data: {
            spent: newSpent,
            remaining: newRemaining,
            status: newRemaining < 0 ? 'EXCEEDED' : budget.status
          }
        });
      }

      updateData.amount = parseFloat(amount);
    }

    const expense = await prisma.budgetExpense.update({
      where: { id: req.params.expenseId },
      data: updateData
    });

    res.json({
      status: 'success',
      data: expense
    });
  } catch (error) {
    next(error);
  }
});

// Delete expense
router.delete('/:budgetId/expenses/:expenseId', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const expense = await prisma.budgetExpense.findUnique({
      where: { id: req.params.expenseId }
    });

    if (!expense) {
      throw new AppError('Expense not found', 404);
    }

    // Delete expense
    await prisma.budgetExpense.delete({
      where: { id: req.params.expenseId }
    });

    // Recalculate budget
    const budget = await prisma.budget.findUnique({
      where: { id: req.params.budgetId }
    });

    if (budget) {
      const newSpent = budget.spent - expense.amount;
      const newRemaining = budget.allocated - newSpent;

      await prisma.budget.update({
        where: { id: req.params.budgetId },
        data: {
          spent: newSpent,
          remaining: newRemaining,
          status: newRemaining < 0 ? 'EXCEEDED' : 'ACTIVE'
        }
      });
    }

    res.json({
      status: 'success',
      message: 'Expense deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

// Get budget summary/analytics
router.get('/analytics/summary', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const budgets = await prisma.budget.findMany({
      include: {
        expenses: true
      }
    });

    const summary = {
      totalBudgets: budgets.length,
      totalAllocated: budgets.reduce((sum, b) => sum + b.allocated, 0),
      totalSpent: budgets.reduce((sum, b) => sum + b.spent, 0),
      totalRemaining: budgets.reduce((sum, b) => sum + (b.allocated - b.spent), 0),
      byCategory: budgets.map(b => ({
        category: b.category,
        allocated: b.allocated,
        spent: b.spent,
        remaining: b.allocated - b.spent,
        percentage: (b.spent / b.allocated) * 100,
        status: b.status
      })),
      exceededBudgets: budgets.filter(b => b.spent > b.allocated).length,
      activeBudgets: budgets.filter(b => b.status === 'ACTIVE').length
    };

    res.json({
      status: 'success',
      data: summary
    });
  } catch (error) {
    next(error);
  }
});

export default router;
