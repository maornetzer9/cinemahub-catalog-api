const express = require('express');
const { loadingMoviesController, editMovieController, addMovieController, deleteMovieController } = require('../controllers/movies');
const authMiddleware = require('../middleware/auth');
const enforcePasswordChanged = require('../middleware/enforcePasswordChanged');
const requirePermission = require('../middleware/requirePermission');
const { requireAnyPermission } = require('../middleware/requirePermission');

const router = express.Router();

router.get('/',           authMiddleware, enforcePasswordChanged, requireAnyPermission(['View-Movies', 'Create-Subscriptions']), loadingMoviesController );
router.post('/add',       authMiddleware, enforcePasswordChanged, requirePermission('Create-Movies'), addMovieController      );
router.put('/edit',       authMiddleware, enforcePasswordChanged, requirePermission('Update-Movies'), editMovieController     );
router.delete('/delete',  authMiddleware, enforcePasswordChanged, requirePermission('Delete-Movies'), deleteMovieController   );

module.exports = { moviesRouter: router };
