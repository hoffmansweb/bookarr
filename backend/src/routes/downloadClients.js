const express = require('express');
const router = express.Router();
const downloadClientController = require('../controllers/downloadClientController');
const { auth, adminAuth } = require('../middleware/auth');

router.use(auth);
router.use(adminAuth);

router.get('/', downloadClientController.getAll);
router.post('/', downloadClientController.create);
router.put('/:id', downloadClientController.update);
router.delete('/:id', downloadClientController.delete);
router.post('/test', downloadClientController.test);
router.post('/aria2/clear', downloadClientController.clearAria2);

module.exports = router;
