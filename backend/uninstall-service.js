const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'Bookarr',
  script: path.join(__dirname, 'src', 'server.js')
});

svc.on('uninstall', () => {
  console.log('Service uninstalled successfully!');
});

svc.uninstall();
