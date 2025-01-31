require('dotenv').config();
const StellarSdk = require('@stellar/stellar-sdk');
const { balanceMonitor } = require('./spot_priceBLND_AQUA.js');
const EventEmitter = require('events');

const {
    Address,
    Contract,
    TransactionBuilder,
    rpc,
    Horizon,
    BASE_FEE,
    Networks,
    xdr,
    TimeoutInfinite,
    XdrLargeInt,
    Keypair,
} = StellarSdk;

// Contract addresses
const POOL_CONTRACT = "CAB6MICC2WKRT372U3FRPKGGVB5R3FDJSMWSLPF2UJNJPYMBZ76RQVYE";
const BLND_TOKEN_CONTRACT = "CD25MNVTZDL4Y3XBCPCJXGXATV5WUHHOWMYFF4YBEGU5FCPGMYTVG5JY";
const AQUA_TOKEN_CONTRACT = "CAUIKL3IYGMERDRUN6YSCLWVAKIFG5Q4YJHUKM4S4NJZQIA3BAS6OJPK";

// Configuration
const sorobanServerUrl = 'https://mainnet.sorobanrpc.com';
const horizonServerUrl = 'https://horizon.stellar.org';

// Create event emitter for sell order events
const sellOrderEmitter = new EventEmitter();

// Trading parameters
const slippagePercent = 1; // 1% slippage tolerance
const inIdx = 1;  // BLND index in pool
const outIdx = 0; // AQUA index in pool

function u128ToInt(value) {
    const result = (BigInt(value.hi()._value) << 64n) + BigInt(value.lo()._value);
    if (result <= BigInt(Number.MAX_SAFE_INTEGER)) {
        return Number(result);
    } else {
        console.warn("Value exceeds JavaScript's safe integer range");
        return null;
    }
}

async function estimateSellSwap(amountIn) {
    try {
        const sorobanServer = new rpc.Server(sorobanServerUrl);

        const amount = new XdrLargeInt("u128", amountIn.toFixed()).toU128();
        const inIdxSCVal = xdr.ScVal.scvU32(inIdx);
        const outIdxSCVal = xdr.ScVal.scvU32(outIdx);

        const keypair = Keypair.fromSecret(process.env.STELLAR_PRIVATE_KEY);
        const account = await sorobanServer.getAccount(keypair.publicKey());

        const contract = new Contract(POOL_CONTRACT);

        const tx = new TransactionBuilder(account, {
            fee: BASE_FEE,
            networkPassphrase: Networks.PUBLIC,
        })
        .addOperation(
            contract.call(
                "estimate_swap",
                inIdxSCVal,
                outIdxSCVal,
                amount,
            ),
        )
        .setTimeout(TimeoutInfinite)
        .build();

        const simulateResult = await sorobanServer.simulateTransaction(tx);

        if (!simulateResult.result) {
            console.error('Simulation error:', simulateResult.error);
            throw new Error("Unable to simulate transaction");
        }

        const result = u128ToInt(simulateResult.result.retval.value());
        console.log(`Estimated AQUA to receive: ${result / 1e7}`);
        return result;
    } catch (error) {
        console.error('Error estimating sell swap:', error);
        throw error;
    }
}

async function executeSellSwap(amountIn) {
    try {
        const sorobanServer = new rpc.Server(sorobanServerUrl);
        const horizonServer = new Horizon.Server(horizonServerUrl);

        const amount = new XdrLargeInt("u128", amountIn.toFixed()).toU128();

        // Get estimated output amount and apply slippage tolerance
        const estimatedResult = await estimateSellSwap(amountIn);
        const slippageCoefficient = (100 - slippagePercent) / 100;
        const estimateWithSlippage = Math.floor(estimatedResult * slippageCoefficient);
        const minimumOut = new XdrLargeInt("u128", estimateWithSlippage.toFixed()).toU128();

        const inIdxSCVal = xdr.ScVal.scvU32(inIdx);
        const outIdxSCVal = xdr.ScVal.scvU32(outIdx);

        const keypair = Keypair.fromSecret(process.env.STELLAR_PRIVATE_KEY);
        const account = await sorobanServer.getAccount(keypair.publicKey());

        const contract = new Contract(POOL_CONTRACT);

        const tx = new TransactionBuilder(account, {
            fee: BASE_FEE,
            networkPassphrase: Networks.PUBLIC,
        })
        .addOperation(
            contract.call(
                "swap",
                xdr.ScVal.scvAddress(
                    Address.fromString(keypair.publicKey()).toScAddress(),
                ),
                inIdxSCVal,
                outIdxSCVal,
                amount,
                minimumOut,
            ),
        )
        .setTimeout(TimeoutInfinite)
        .build();

        const preparedTx = await sorobanServer.prepareTransaction(tx);
        preparedTx.sign(keypair);

        console.log(`Executing sell swap of ${amountIn / 1e7} BLND...`);
        const result = await horizonServer.submitTransaction(preparedTx);
        
        if (result.successful) {
            const meta = (await sorobanServer.getTransaction(result.id)).resultMetaXdr;
            const returnValue = meta.v3().sorobanMeta().returnValue();
            const outValue = u128ToInt(returnValue.value());

            console.log("Sell swap successful!");
            console.log(`Received AQUA: ${outValue / 1e7}`);

            // Emit sell order filled event
            sellOrderEmitter.emit('sellOrderFilled', {
                transactionId: result.id,
                amountIn: amountIn / 1e7,
                amountOut: outValue / 1e7
            });

            return {
                success: true,
                transactionId: result.id,
                amountOut: outValue
            };
        } else {
            throw new Error('Transaction failed: ' + JSON.stringify(result.extras.result_codes));
        }
    } catch (error) {
        console.error('Error executing sell swap:', error);
        throw error;
    }
}

// Monitor spot price updates
balanceMonitor.on('update', async ({ spotPrice }) => {
    sellOrderEmitter.emit('spotPriceUpdate', spotPrice);
});

// Export functions and emitter
module.exports = {
    executeSellSwap,
    estimateSellSwap,
    sellOrderEmitter
};