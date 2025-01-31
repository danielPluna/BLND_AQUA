const dotenv = require('dotenv');
const result = dotenv.config();

if (result.error) {
    console.error('Error loading .env file:', result.error);
    process.exit(1);
}

const StellarSdk = require('@stellar/stellar-sdk');

// Verify environment variable
if (!process.env.STELLAR_PRIVATE_KEY) {
    console.error('STELLAR_PRIVATE_KEY is not set in .env file');
    process.exit(1);
}

const server = new StellarSdk.Horizon.Server('https://horizon.stellar.org');
const AQUA = new StellarSdk.Asset('AQUA', 'GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA');
const USDC = new StellarSdk.Asset('USDC', 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');

async function createAQUABuyOrder() {
    try {
        console.log('Starting AQUA buy order creation...');
        
        const sourceKeypair = StellarSdk.Keypair.fromSecret(process.env.STELLAR_PRIVATE_KEY);
        console.log('Keypair created successfully');
        
        console.log('Loading account...');
        const account = await server.loadAccount(sourceKeypair.publicKey());
        console.log('Account loaded successfully');
        
        console.log('Creating buy order for 100 AQUA at 0.0014 USDC each...');
        
        const operation = StellarSdk.Operation.manageBuyOffer({
            selling: USDC,
            buying: AQUA,
            buyAmount: '100',
            price: '0.0014',
            offerId: 0  // 0 for new offer
        });

        console.log('Fetching base fee...');
        const fee = await server.fetchBaseFee();
        console.log('Base fee:', fee);

        const tx = new StellarSdk.TransactionBuilder(account, {
            fee: fee,
            networkPassphrase: StellarSdk.Networks.PUBLIC
        })
        .addOperation(operation)
        .setTimeout(30)
        .build();

        tx.sign(sourceKeypair);
        
        console.log('Submitting buy order transaction...');
        const result = await server.submitTransaction(tx);
        
        if (result.successful) {
            console.log('AQUA Buy order created successfully!');
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
createAQUABuyOrder().catch(console.error);