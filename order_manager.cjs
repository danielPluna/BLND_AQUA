const StellarSdk = require('@stellar/stellar-sdk');
const EventEmitter = require('events');
const { balanceMonitor } = require('./spot_priceBLND_AQUA.js');
const { placeBuyOrders, cancelExistingOrders } = require('./BLND_AQUA_orders.cjs');
const { executeSellSwap, sellOrderEmitter } = require('./BLND_AQUA_sell_orders.cjs');

const server = new StellarSdk.Horizon.Server('https://horizon.stellar.org');

class OrderManager extends EventEmitter {
    constructor(privateKey) {
        super();
        this.privateKey = privateKey;
        this.keypair = StellarSdk.Keypair.fromSecret(privateKey);
        this.currentSpotPrice = null;
        this.activeBuyOrders = new Map();
        this.isProcessing = false;
        this.lastBuyFillTime = null;
        this.PROCESSING_COOLDOWN = 10000; // 10 second cooldown between cycles
    }

    async initialize() {
        console.log('Initializing Order Manager...');
        
        // Start monitoring spot price
        balanceMonitor.on('update', async ({ spotPrice, formattedPrice }) => {
            console.log(`Spot Price Update: ${formattedPrice} AQUA/BLND`);
            this.currentSpotPrice = spotPrice;
            await this.updateBuyOrders();
        });

        // Start monitoring buy order fills
        this.startOrderMonitoring();

        // Initial buy orders
        await this.updateBuyOrders();

        console.log('Order Manager initialized successfully');
    }

    async startOrderMonitoring() {
        console.log('Starting order monitoring...');
        const cursor = 'now';
        const account = this.keypair.publicKey();
        
        server.operations()
            .forAccount(account)
            .cursor(cursor)
            .stream({
                onmessage: async (operation) => {
                    if (operation.type === 'manage_buy_offer' && operation.amount === '0') {
                        await this.handleBuyOrderFill(operation);
                    }
                },
                onerror: (error) => {
                    console.error('Error in order monitoring:', error);
                    // Attempt to restart monitoring after a delay
                    setTimeout(() => this.startOrderMonitoring(), 5000);
                }
            });
    }

    async handleBuyOrderFill(operation) {
        try {
            const currentTime = Date.now();
            
            // Check cooldown period
            if (this.lastBuyFillTime && 
                currentTime - this.lastBuyFillTime < this.PROCESSING_COOLDOWN) {
                console.log('Skipping processing due to cooldown period');
                return;
            }

            console.log('Buy order filled, executing sell swap...');
            this.lastBuyFillTime = currentTime;

            // Convert the filled amount to the correct format for the sell swap
            const filledAmount = Math.floor(parseFloat(operation.amount) * 1e7); // Convert to stroops

            // Execute the sell swap
            const sellResult = await executeSellSwap(filledAmount);
            
            if (sellResult.success) {
                console.log('Sell swap executed successfully');
                console.log(`Received: ${sellResult.amountOut / 1e7} AQUA`);
                
                // Wait for a short period before updating buy orders
                setTimeout(async () => {
                    await this.updateBuyOrders();
                }, 2000);
            }
        } catch (error) {
            console.error('Error handling buy order fill:', error);
        }
    }

    async updateBuyOrders() {
        if (this.isProcessing || !this.currentSpotPrice) {
            console.log('Skipping update - already processing or no spot price');
            return;
        }

        try {
            this.isProcessing = true;
            console.log('Updating buy orders...');

            // Cancel existing orders
            await cancelExistingOrders();

            // Place new buy orders
            await placeBuyOrders(this.currentSpotPrice);

            console.log('Buy orders updated successfully');
        } catch (error) {
            console.error('Error updating buy orders:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    async checkAccountBalances() {
        try {
            const account = await server.loadAccount(this.keypair.publicKey());
            
            // Find BLND and AQUA balances
            const blndBalance = account.balances.find(b => 
                b.asset_code === 'BLND' && 
                b.asset_issuer === 'GDJEHTBE6ZHUXSWFI642DCGLUOECLHPF3KSXHPXTSTJ7E3JF6MQ5EZYY'
            );
            
            const aquaBalance = account.balances.find(b => 
                b.asset_code === 'AQUA' && 
                b.asset_issuer === 'GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA'
            );

            return {
                BLND: blndBalance ? parseFloat(blndBalance.balance) : 0,
                AQUA: aquaBalance ? parseFloat(aquaBalance.balance) : 0
            };
        } catch (error) {
            console.error('Error checking balances:', error);
            throw error;
        }
    }

    async shutdown() {
        console.log('Shutting down Order Manager...');
        try {
            // Cancel all existing orders
            await cancelExistingOrders();
            
            // Remove all listeners
            this.removeAllListeners();
            balanceMonitor.removeAllListeners();
            sellOrderEmitter.removeAllListeners();
            
            console.log('Shutdown complete');
        } catch (error) {
            console.error('Error during shutdown:', error);
        }
    }
}

// Export the OrderManager class
module.exports = OrderManager;

// Example usage:
if (require.main === module) {
    const dotenv = require('dotenv');
    dotenv.config();

    async function main() {
        try {
            const manager = new OrderManager(process.env.STELLAR_PRIVATE_KEY);
            
            // Handle shutdown signals
            process.on('SIGINT', async () => {
                console.log('\nReceived shutdown signal...');
                await manager.shutdown();
                process.exit(0);
            });

            // Initialize the manager
            await manager.initialize();
            
            // Log initial balances
            const balances = await manager.checkAccountBalances();
            console.log('\nInitial Balances:');
            console.log(`BLND: ${balances.BLND}`);
            console.log(`AQUA: ${balances.AQUA}`);
            
        } catch (error) {
            console.error('Error in main:', error);
            process.exit(1);
        }
    }

    main();
}