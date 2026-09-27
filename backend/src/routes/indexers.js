const express = require('express');
const router = express.Router();
const indexerController = require('../controllers/indexerController');
const { auth, adminAuth } = require('../middleware/auth');

router.use(auth);
router.use(adminAuth);

router.get('/', indexerController.getAll);
router.post('/', indexerController.create);
router.put('/:id', indexerController.update);
router.delete('/:id', indexerController.delete);
router.post('/test', indexerController.test);
router.post('/discover', indexerController.discover);
router.post('/sync', indexerController.sync);

module.exports = router;
