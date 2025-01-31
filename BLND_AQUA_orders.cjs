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
        const sourceKeypair = StellarSdk.Keypair.fromSecret(process.env.STELLAR_PRIVATE_KEY);
        const account = await server.loadAccount(sourceKeypair.publicKey());
        
        const placedOrders = [];
        
        for (let i = 1; i <= NUM_BUCKETS; i++) {
            const discount = 1 - (BUCKET_INCREMENT * i);
            const orderPrice = spotPrice * discount;
            
            // Convert order price to price fraction for Stellar
            // Price is in AQUA/BLND, so we need to represent how many AQUA for 1 BLND
            const priceNumerator = parseInt((orderPrice * 10000000).toFixed(0));
            const priceObj = {
                n: priceNumerator,
                d: 10000000
            };

            const operation = StellarSdk.Operation.manageBuyOffer({
                selling: AQUA,
                buying: BLND,
                buyAmount: UNIT_SIZE.toFixed(7),
                price: priceObj,
                offerId: 0
            });

            const tx = new StellarSdk.TransactionBuilder(account, {
                fee: await server.fetchBaseFee(),
                networkPassphrase: StellarSdk.Networks.PUBLIC
            })
            .addOperation(operation)
            .setTimeout(30)
            .build();

            tx.sign(sourceKeypair);
            
            console.log(`Placing order ${i}: ${UNIT_SIZE} BLND at ${orderPrice.toFixed(7)} AQUA/BLND`);
            const result = await server.submitTransaction(tx);

            if (result.successful) {
                console.log(`Order ${i} placed successfully!`);
                console.log('Transaction ID:', result.id);
                
                // Add order to tracking array
                placedOrders.push({
                    orderId: result.id,
                    amount: UNIT_SIZE,
                    price: orderPrice,
                    bucket: i
                });

                // Emit event for placed order
                buyOrderEmitter.emit('orderPlaced', {
                    orderId: result.id,
                    amount: UNIT_SIZE,
                    price: orderPrice,
                    bucket: i
                });
            } else {
                console.error(`Order ${i} failed:`, JSON.stringify(result.extras.result_codes, null, 2));
            }
        }

        // Emit event for all orders placed
        buyOrderEmitter.emit('allOrdersPlaced', placedOrders);
        return placedOrders;
        
    } catch (error) {
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

// Only run main if script is run directly
if (require.main === module) {
    async function main() {
        const spotPrice = 1.5; // Example spot price
        
        if (process.argv.includes('--check')) {
            await checkActiveOrders();
        } else if (process.argv.includes('--cancel')) {
            await cancelExistingOrders();
        } else {
            await placeBuyOrders(spotPrice);
        }
    }

    main().catch(console.error);
}