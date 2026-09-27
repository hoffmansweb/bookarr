const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'Bookarr',
  description: 'Bookarr Book Management System',
  script: path.join(__dirname, 'src', 'server.js'),
  nodeOptions: ['--harmony', '--max_old_space_size=4096'],
  env: [{
    name: "NODE_ENV",
    value: "production"
  }]
});

svc.on('install', () => {
  console.log('Service installed successfully!');
  svc.start();
});

svc.on('alreadyinstalled', () => {
  console.log('Service is already installed.');
});

svc.on('error', (err) => {
  console.error('Service installation error:', err);
});

svc.install();
