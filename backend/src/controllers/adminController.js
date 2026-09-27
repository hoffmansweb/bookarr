const { User } = require('../models');

exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: ['password', 'amazonCookies'] },
      order: [['createdAt', 'DESC']]
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { username, email, role } = req.body;
    // Only apply fields that were actually sent; undefined values previously
    // tripped the NOT NULL validators on username/email.
    const updates = {};
    if (username !== undefined) updates.username = username;
    if (email !== undefined) updates.email = email;
    if (role !== undefined) {
      if (!['user', 'admin'].includes(role)) {
        return res.status(400).json({ error: 'Role must be "user" or "admin"' });
      }
      if (String(user.id) === String(req.user.id) && role !== 'admin') {
        return res.status(400).json({ error: 'You cannot remove your own admin role' });
      }
      updates.role = role;
    }
    await user.update(updates);
    
    const updated = await User.findByPk(user.id, {
      attributes: { exclude: ['password', 'amazonCookies'] }
    });
    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    if (String(req.params.id) === String(req.user.id)) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    await user.destroy();
    res.json({ message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
