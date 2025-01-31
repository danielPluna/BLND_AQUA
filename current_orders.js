import dotenv from 'dotenv';
import StellarSdk from '@stellar/stellar-sdk';
dotenv.config();

const server = new StellarSdk.Horizon.Server('https://horizon.stellar.org');
const BLND = new StellarSdk.Asset('BLND', 'GDJEHTBE6ZHUXSWFI642DCGLUOECLHPF3KSXHPXTSTJ7E3JF6MQ5EZYY');
const AQUA = new StellarSdk.Asset('AQUA', 'GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA');

async function checkActiveOrders() {
    try {
        if (!process.env.STELLAR_PRIVATE_KEY) {
            throw new Error('STELLAR_PRIVATE_KEY is not set in .env file');
        }

        const sourceKeypair = StellarSdk.Keypair.fromSecret(process.env.STELLAR_PRIVATE_KEY);
        console.log('Checking orders for account:', sourceKeypair.publicKey());

        const offers = await server.offers()
            .forAccount(sourceKeypair.publicKey())
            .call();

        console.log('\nActive Orders:');
        console.log('='.repeat(50));
        
        let count = 0;
        for (const offer of offers.records) {
            if (offer.buying.asset_code === 'BLND' && offer.selling.asset_code === 'AQUA') {
                count++;
                console.log(`Order #${count}:`);
                console.log(`Order ID: ${offer.id}`);
                console.log(`Buying: ${offer.buying.asset_code}`);
                console.log(`Amount: ${offer.amount}`);
                console.log(`Price: ${offer.price} AQUA/BLND`);
                console.log('-'.repeat(50));
            }
        }

        console.log(`\nTotal BLND/AQUA Orders: ${count}`);

    } catch (error) {
        console.error('Error checking orders:', error.message);
    }
}

// Run the function
checkActiveOrders();