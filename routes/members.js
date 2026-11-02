const express = require('express');
const { loadMembersController, newMemberController, deleteMemberController, editMemberController, newSubscriptionController } = require('../controllers/members');
const authMiddleware = require('../middleware/auth');
const enforcePasswordChanged = require('../middleware/enforcePasswordChanged');
const requirePermission = require('../middleware/requirePermission');

const router = express.Router();

router.get('/',                  authMiddleware, enforcePasswordChanged, requirePermission('View-Subscriptions'), loadMembersController     );
router.put('/edit',              authMiddleware, enforcePasswordChanged, requirePermission('Update-Subscriptions'), editMemberController      );
router.post('/add',              authMiddleware, enforcePasswordChanged, requirePermission('Create-Subscriptions'), newMemberController       );
router.post('/new-subscription', authMiddleware, enforcePasswordChanged, requirePermission('Create-Subscriptions'), newSubscriptionController );
router.delete('/delete',         authMiddleware, enforcePasswordChanged, requirePermission('Delete-Subscriptions'), deleteMemberController    );

module.exports = { membersRouter: router };
