const { Book, Author } = require('../models');
const { Op } = require('sequelize');

exports.getCalendarEvents = async (req, res) => {
  try {
    const { start, end } = req.query;
    
    // Get monitored authors for this user
    const monitoredAuthors = await req.user.getMonitoredAuthors();
    const authorIds = monitoredAuthors.map(a => a.id);

    if (authorIds.length === 0) {
      return res.json([]);
    }

    const whereClause = {
      authorId: { [Op.in]: authorIds },
      publishedDate: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] }
    };

    const books = await Book.findAll({
      where: whereClause,
      include: [{ model: Author, as: 'author' }],
      order: [['publishedDate', 'ASC']]
    });

    // Format results for the calendar
    let events = books.map(book => {
      // Standardize date to YYYY-MM-DD if possible
      let dateStr = book.publishedDate;
      if (/^\d{4}$/.test(dateStr)) {
        dateStr = `${dateStr}-01-01`; // Default to start of year
      } else if (/^\d{4}-\d{2}$/.test(dateStr)) {
        dateStr = `${dateStr}-01`; // Default to start of month
      }

      return {
        id: book.id,
        title: book.title,
        subtitle: book.subtitle,
        description: book.description,
        publishedDate: book.publishedDate,
        date: dateStr,
        author: book.author?.name || 'Unknown Author',
        coverUrl: book.coverUrl,
        status: book.status,
        mediaType: book.mediaType
      };
    });

    // Filter by start and end date parameters if provided
    if (start || end) {
      events = events.filter(e => {
        const dateVal = new Date(e.date).getTime();
        if (isNaN(dateVal)) return false;
        
        if (start && dateVal < new Date(start).getTime()) return false;
        if (end && dateVal > new Date(end).getTime()) return false;
        return true;
      });
    }

    res.json(events);
  } catch (error) {
    console.error('Calendar error:', error);
    res.status(500).json({ error: error.message });
  }
};
