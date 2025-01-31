import { startMonitor, balanceMonitor } from './spot_priceBLND_AQUA.js';

console.log('Starting test...');

// Add listener before starting monitor
balanceMonitor.on('update', (data) => {
    console.log('Received update:', data);
});

// Start the monitor
const intervalId = startMonitor();

// Optional: Stop after 30 seconds for testing
setTimeout(() => {
    console.log('Test complete, stopping monitor...');
    clearInterval(intervalId);
    process.exit(0);
}, 30000);