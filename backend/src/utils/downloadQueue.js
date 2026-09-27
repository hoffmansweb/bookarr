const logger = require('../config/logger');

class DownloadQueue {
  constructor() {
    this.queue = [];
    this.processing = new Map();
    this.maxConcurrent = 3; // Process 3 downloads at once
  }

  add(task) {
    const taskId = `${task.bookId}-${Date.now()}`;
    this.queue.push({ ...task, id: taskId });
    logger.info(`Added to queue: ${task.title} (Queue size: ${this.queue.length})`);
    this.process();
    return taskId;
  }

  async process() {
    if (this.processing.size >= this.maxConcurrent) {
      return; // Already at max capacity
    }

    const task = this.queue.shift();
    if (!task) {
      return; // Queue empty
    }

    this.processing.set(task.id, task);
    logger.info(`Processing: ${task.title} (${this.processing.size}/${this.maxConcurrent} active)`);

    try {
      await task.handler();
      logger.info(`Completed: ${task.title}`);
    } catch (error) {
      logger.error(`Failed: ${task.title} - ${error.message}`);
    } finally {
      this.processing.delete(task.id);
      // Process next item
      setImmediate(() => this.process());
    }
  }

  getStatus() {
    return {
      queued: this.queue.length,
      processing: this.processing.size,
      total: this.queue.length + this.processing.size
    };
  }

  isProcessing(bookId) {
    return Array.from(this.processing.values()).some(t => t.bookId === bookId) ||
           this.queue.some(t => t.bookId === bookId);
  }
}

module.exports = new DownloadQueue();
