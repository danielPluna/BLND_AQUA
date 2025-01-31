require('dotenv').config();
const StellarSdk = require('@stellar/stellar-sdk');
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

// Swap parameters
const amountIn = 5000000; // 0.5 BLND in stroops (7 decimal places)
const inIdx = 1;  // BLND index in pool
const outIdx = 0; // AQUA index in pool
const slippagePercent = 1; // 1% slippage tolerance

function u128ToInt(value) {
    const result = (BigInt(value.hi()._value) << 64n) + BigInt(value.lo()._value);
    if (result <= BigInt(Number.MAX_SAFE_INTEGER)) {
        return Number(result);
    } else {
        console.warn("Value exceeds JavaScript's safe integer range");
        return null;
    }
}

async function estimateSwap() {
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
        console.log(simulateResult.error);
        console.log("Unable to simulate transaction");
        return NaN;
    }

    const result = u128ToInt(simulateResult.result.retval.value());
    console.log(`Estimated AQUA to receive: ${result / 1e7}`);
    return result;
}

async function executeSwap() {
    const sorobanServer = new rpc.Server(sorobanServerUrl);
    const horizonServer = new Horizon.Server(horizonServerUrl);

    const amount = new XdrLargeInt("u128", amountIn.toFixed()).toU128();

    const slippageCoefficient = (100 - slippagePercent) / 100;
    const estimatedResult = await estimateSwap();
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

    const result = await horizonServer.submitTransaction(preparedTx);
    const meta = (await sorobanServer.getTransaction(result.id)).resultMetaXdr;
    const returnValue = meta.v3().sorobanMeta().returnValue();

    const outValue = u128ToInt(returnValue.value());

    console.log("Swap successful!");
    console.log(`Received AQUA: ${outValue / 1e7}`);
}

// Execute the swap
executeSwap().catch(console.error);