const sequelize = require('./src/config/database');
const { User } = require('./src/models');

async function makeAdmin() {
  try {
    await sequelize.authenticate();
    console.log('Database connected');

    // Get the first user
    const user = await User.findOne({ order: [['createdAt', 'ASC']] });
    
    if (!user) {
      console.log('No users found');
      process.exit(0);
    }

    await user.update({ role: 'admin' });
    console.log(`User ${user.username} (${user.email}) is now an admin!`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

makeAdmin();
