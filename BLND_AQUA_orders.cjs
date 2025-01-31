const dotenv = require('dotenv');
const StellarSdk = require('@stellar/stellar-sdk');
const EventEmitter = require('events');

dotenv.config();

const server = new StellarSdk.Horizon.Server('https://horizon.stellar.org');
const BLND = new StellarSdk.Asset('BLND', 'GDJEHTBE6ZHUXSWFI642DCGLUOECLHPF3KSXHPXTSTJ7E3JF6MQ5EZYY');
const AQUA = new StellarSdk.Asset('AQUA', 'GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA');

// Create event emitter for buy order events
const buyOrderEmitter = new EventEmitter();

// Trading parameters
const UNIT_SIZE = 0.05;  // Amount of BLND to buy in each order
const BUCKET_INCREMENT = 0.005; // 0.5% price decrease per bucket
const NUM_BUCKETS = 10;

async function cancelExistingOrders() {
    try {
        const sourceKeypair = StellarSdk.Keypair.fromSecret(process.env.STELLAR_PRIVATE_KEY);
        const offers = await server.offers()
            .forAccount(sourceKeypair.publicKey())
            .call();

        if (offers.records.length > 0) {
            const account = await server.loadAccount(sourceKeypair.publicKey());
            const tx = new StellarSdk.TransactionBuilder(account, {
                fee: await server.fetchBaseFee(),
                networkPassphrase: StellarSdk.Networks.PUBLIC
            });

            offers.records.forEach(offer => {
                tx.addOperation(StellarSdk.Operation.manageBuyOffer({
                    selling: AQUA,
                    buying: BLND,
                    buyAmount: '0',
                    price: '1',
                    offerId: offer.id
                }));
            });

            const transaction = tx.setTimeout(30).build();
            transaction.sign(sourceKeypair);
            await server.submitTransaction(transaction);
            console.log('All existing orders cancelled');
            
            // Emit event for cancelled orders
            buyOrderEmitter.emit('ordersCancelled');
        }
    } catch (error) {
        console.error('Error cancelling orders:', error);
        throw error;
    }
}

async function placeBuyOrders(spotPrice) {
    try {
        console.log('\n=== Starting Order Placement ===');
        console.log('Initial spot price:', spotPrice);
        console.log('Number of buckets:', NUM_BUCKETS);
        console.log('Bucket increment:', BUCKET_INCREMENT);
        console.log('Unit size:', UNIT_SIZE);
        
        const sourceKeypair = StellarSdk.Keypair.fromSecret(process.env.STELLAR_PRIVATE_KEY);
        const account = await server.loadAccount(sourceKeypair.publicKey());
        console.log('\nAccount loaded:', sourceKeypair.publicKey());
        
        const placedOrders = [];
        
        for (let i = 1; i <= NUM_BUCKETS; i++) {
            console.log('\n--- Processing Bucket', i, '---');
            const discount = 1 - (BUCKET_INCREMENT * i);
            console.log('Calculated discount:', discount.toFixed(4));
            
            const orderPrice = spotPrice * discount;
            console.log('Raw order price:', orderPrice.toFixed(7));
            
            // Convert order price to price fraction for Stellar
            const priceNumerator = parseInt((orderPrice * 10000000).toFixed(0));
            const priceObj = {
                n: priceNumerator,
                d: 10000000
            };
            console.log('Price fraction:', `${priceObj.n}/${priceObj.d}`);
            console.log('Decimal price:', (priceObj.n / priceObj.d).toFixed(7));

            const operation = StellarSdk.Operation.manageBuyOffer({
                selling: AQUA,
                buying: BLND,
                buyAmount: UNIT_SIZE.toFixed(7),
                price: priceObj,
                offerId: 0
            });
            
            console.log('\nOrder details:');
            console.log('- Buy amount:', UNIT_SIZE.toFixed(7), 'BLND');
            console.log('- Price:', orderPrice.toFixed(7), 'AQUA/BLND');
            console.log('- Total AQUA needed:', (UNIT_SIZE * orderPrice).toFixed(7));

            const tx = new StellarSdk.TransactionBuilder(account, {
                fee: await server.fetchBaseFee(),
                networkPassphrase: StellarSdk.Networks.PUBLIC
            })
            .addOperation(operation)
            .setTimeout(30)
            .build();

            tx.sign(sourceKeypair);
            
            console.log('\nSubmitting transaction...');
            const result = await server.submitTransaction(tx);

            if (result.successful) {
                console.log(`✅ Order ${i} placed successfully!`);
                console.log('Transaction ID:', result.id);
                
                placedOrders.push({
                    orderId: result.id,
                    amount: UNIT_SIZE,
                    price: orderPrice,
                    bucket: i
                });

                buyOrderEmitter.emit('orderPlaced', {
                    orderId: result.id,
                    amount: UNIT_SIZE,
                    price: orderPrice,
                    bucket: i
                });
            } else {
                console.error(`❌ Order ${i} failed:`, JSON.stringify(result.extras.result_codes, null, 2));
            }
        }

        console.log('\n=== Order Placement Complete ===');
        console.log('Total orders placed:', placedOrders.length);
        console.log('Price range:', placedOrders.length > 0 ? {
            highest: placedOrders[0].price.toFixed(7),
            lowest: placedOrders[placedOrders.length - 1].price.toFixed(7)
        } : 'No orders placed');
        
        buyOrderEmitter.emit('allOrdersPlaced', placedOrders);
        return placedOrders;
        
    } catch (error) {
        console.error('\n❌ Error in placeBuyOrders:');
        if (error.response && error.response.data) {
            console.error('Error details:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('Error:', error);
        }
        throw error;
    }
}

async function checkActiveOrders() {
    try {
        const sourceKeypair = StellarSdk.Keypair.fromSecret(process.env.STELLAR_PRIVATE_KEY);
        const offers = await server.offers()
            .forAccount(sourceKeypair.publicKey())
            .call();

        const activeOrders = [];
        
        console.log('\nCurrent Active Orders:');
        console.log('-------------------');
        offers.records.forEach(offer => {
            if (offer.buying.asset_code === 'BLND' && offer.selling.asset_code === 'AQUA') {
                const orderInfo = {
                    orderId: offer.id,
                    amount: offer.amount,
                    price: offer.price
                };
                activeOrders.push(orderInfo);
                
                console.log(`Order ID: ${offer.id}`);
                console.log(`Buying: ${offer.amount} ${offer.buying.asset_code}`);
                console.log(`Price: ${offer.price} AQUA/BLND`);
                console.log('-------------------');
            }
        });

        // Emit event with active orders
        buyOrderEmitter.emit('activeOrders', activeOrders);
        return activeOrders;
    } catch (error) {
        console.error('Error checking orders:', error);
        throw error;
    }
}

// Export everything needed by the order manager
module.exports = {
    placeBuyOrders,
    cancelExistingOrders,
    checkActiveOrders,
    buyOrderEmitter,
    UNIT_SIZE,
    BUCKET_INCREMENT,
    NUM_BUCKETS
};

// Update main function to use real spot price
if (require.main === module) {
    async function main() {
        if (process.argv.includes('--check')) {
            await checkActiveOrders();
        } else if (process.argv.includes('--cancel')) {
            await cancelExistingOrders();
        } else {
            console.log('Waiting for spot price data...');
            
            // Import the ESM module dynamically
            const spotPriceModule = await import('./spot_priceBLND_AQUA.js');
            const { balanceMonitor, startMonitor } = spotPriceModule;
            
            // Wait for first price update
            balanceMonitor.once('update', async (data) => {
                console.log('Received spot price:', data.spotPrice);
                await placeBuyOrders(data.spotPrice);
                process.exit(0);
            });
            
            // Start the monitor
            startMonitor();
        }
    }

    main().catch(console.error);
}