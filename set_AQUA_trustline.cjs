const dotenv = require('dotenv');
dotenv.config();
const StellarSdk = require('@stellar/stellar-sdk');

const server = new StellarSdk.Horizon.Server('https://horizon.stellar.org');
const AQUA = new StellarSdk.Asset('AQUA', 'GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA');
const PRIVATE_KEY = process.env.STELLAR_PRIVATE_KEY;

async function createAQUATrustline() {
    try {
        const sourceKeypair = StellarSdk.Keypair.fromSecret(PRIVATE_KEY);
        const account = await server.loadAccount(sourceKeypair.publicKey());
        
        console.log('Creating AQUA trustline...');
        
        const operation = StellarSdk.Operation.changeTrust({
            asset: AQUA
        });

        const tx = new StellarSdk.TransactionBuilder(account, {
            fee: await server.fetchBaseFee(),
            networkPassphrase: StellarSdk.Networks.PUBLIC
        })
        .addOperation(operation)
        .setTimeout(30)
        .build();

        tx.sign(sourceKeypair);
        
        console.log('Submitting trustline transaction...');
        const result = await server.submitTransaction(tx);
        
        if (result.successful) {
            console.log('AQUA Trustline created successfully!');
            console.log('Transaction ID:', result.id);
        } else {
            console.error('Transaction failed with details:');
            console.error('Result codes:', JSON.stringify(result.extras.result_codes, null, 2));
        }
    } catch (error) {
        if (error.response && error.response.data) {
            console.error('Error details:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('Error:', error);
        }
    }
}

// Run the function
createAQUATrustline().catch(console.error);