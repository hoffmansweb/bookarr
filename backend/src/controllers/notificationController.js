const { Notification } = require('../models');

exports.getAll = async (req, res) => {
  try {
    const { read } = req.query;
    const where = { userId: req.user.id };
    
    if (read !== undefined) {
      where.read = read === 'true';
    }

    const notifications = await Notification.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: 50
    });

    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.markAsRead = async (req, res) => {
  try {
    const notification = await Notification.findOne({
      where: { id: req.params.id, userId: req.user.id }
    });
    
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    await notification.update({ read: true });
    res.json(notification);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.markAllAsRead = async (req, res) => {
  try {
    await Notification.update(
      { read: true },
      { where: { userId: req.user.id, read: false } }
    );
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const notification = await Notification.findOne({
      where: { id: req.params.id, userId: req.user.id }
    });
    
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    await notification.destroy();
    res.json({ message: 'Notification deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
