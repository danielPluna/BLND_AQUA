const dotenv = require('dotenv');
dotenv.config();
const StellarSdk = require('@stellar/stellar-sdk');
const server = new StellarSdk.Horizon.Server('https://horizon.stellar.org');
const PRIVATE_KEY = process.env.STELLAR_PRIVATE_KEY;
const orderAmount = 5;  // Amount of USDC to sell
const orderPrice = 2.43902439;  // Price in XLM per USDC (1/0.41)

// Assets
const XLM = StellarSdk.Asset.native();
const USDC = new StellarSdk.Asset('USDC', 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');

async function placeSellOrder(privateKey, amount, price) {
    try {
        const sourceKeypair = StellarSdk.Keypair.fromSecret(privateKey);
        const account = await server.loadAccount(sourceKeypair.publicKey());
        
        const priceObj = {
            n: Math.floor(price * 10000000),
            d: 10000000
        };

        const operation = StellarSdk.Operation.manageSellOffer({
            selling: USDC,    // Now selling USDC
            buying: XLM,      // Now buying XLM
            amount: amount.toString(),
            price: priceObj   // Price in XLM per USDC
        });

        const tx = new StellarSdk.TransactionBuilder(account, {
            fee: await server.fetchBaseFee(),
            networkPassphrase: StellarSdk.Networks.PUBLIC
        })
        .addOperation(operation)
        .setTimeout(30)
        .build();

        tx.sign(sourceKeypair);
        const result = await server.submitTransaction(tx);
        
        if (result.successful) {
            console.log(`Order placed successfully: ${amount} USDC for XLM at price ${price} XLM/USDC`);
            return result;
        } else {
            throw new Error(`Transaction failed: ${result.extras.resultCodes}`);
        }
    } catch (error) {
        console.error('Error placing order:', error);
        throw error;
    }
}

// Execute the order
placeSellOrder(PRIVATE_KEY, orderAmount, orderPrice)
    .catch(console.error);