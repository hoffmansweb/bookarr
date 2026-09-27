const User = require('./User');
const Author = require('./Author');
const Book = require('./Book');
const Notification = require('./Notification');
const DownloadClient = require('./DownloadClient');
const Indexer = require('./Indexer');
const Setting = require('./Setting');
const UserBooks = require('./UserBooks');

// Associations
Author.hasMany(Book, { foreignKey: 'authorId', as: 'books' });
Book.belongsTo(Author, { foreignKey: 'authorId', as: 'author' });

User.hasMany(Notification, { foreignKey: 'userId', as: 'notifications' });
Notification.belongsTo(User, { foreignKey: 'userId' });

// Many-to-many for user's library
User.belongsToMany(Book, { through: UserBooks, as: 'library' });
Book.belongsToMany(User, { through: UserBooks, as: 'users' });

// Many-to-many for user's monitored authors
User.belongsToMany(Author, { through: 'UserAuthors', as: 'monitoredAuthors' });
Author.belongsToMany(User, { through: 'UserAuthors', as: 'followers' });

module.exports = {
  User,
  Author,
  Book,
  Notification,
  DownloadClient,
  Indexer,
  Setting,
  UserBooks
};
