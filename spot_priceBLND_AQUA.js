import {
    Account,
    Address,
    Contract,
    rpc,
    scValToNative,
    TransactionBuilder,
    TimeoutInfinite,
} from '@stellar/stellar-sdk';
import EventEmitter from 'events';

export const POOL_CONTRACT = "CAB6MICC2WKRT372U3FRPKGGVB5R3FDJSMWSLPF2UJNJPYMBZ76RQVYE";
export const BLND_TOKEN_CONTRACT = "CD25MNVTZDL4Y3XBCPCJXGXATV5WUHHOWMYFF4YBEGU5FCPGMYTVG5JY";
export const AQUA_TOKEN_CONTRACT = "CAUIKL3IYGMERDRUN6YSCLWVAKIFG5Q4YJHUKM4S4NJZQIA3BAS6OJPK";
const SOROBAN_RPC_URL = "https://mainnet.sorobanrpc.com";
const NETWORK_PASSPHRASE = "Public Global Stellar Network ; September 2015";

export function formatBalance(balance) {
    const balanceStr = balance.toString();
    return balanceStr.slice(0, -7) + "." + balanceStr.slice(-7);
}

async function getBalance(tokenContract) {
    const server = new rpc.Server(SOROBAN_RPC_URL, { allowHttp: true, timeout: 30000 });
    const account = new Account('GANXGJV2RNOFMOSQ2DTI3RKDBAVERXUVFC27KW3RLVQCLB3RYNO3AAI4', '0');
    
    const tx = new TransactionBuilder(account, {
        fee: '1000',
        networkPassphrase: NETWORK_PASSPHRASE,
    })
    .setTimeout(TimeoutInfinite)
    .addOperation(new Contract(tokenContract).call(
        'balance', 
        new Address(POOL_CONTRACT).toScVal()
    ))
    .build();

    const result = await server.simulateTransaction(tx);
    return scValToNative(result.result.retval);
}

async function getLatestLedger() {
    const response = await fetch(SOROBAN_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getLatestLedger"
        })
    });
    const data = await response.json();
    return data.result.sequence;
}

export const balanceMonitor = new EventEmitter();

const BLND_WEIGHT = 0.5;
const AQUA_WEIGHT = 0.5;
const SWAP_FEE = 0.003;

let lastLedger = null;
let lastPrice = null;

export function calculateSpotPrice(aquaBalance, blndBalance) {
    const BAQUA = Number(formatBalance(aquaBalance));
    const BBLND = Number(formatBalance(blndBalance));
    
    const weightedAQUA = BAQUA / AQUA_WEIGHT;
    const weightedBLND = BBLND / BLND_WEIGHT;
    
    const basePrice = weightedAQUA / weightedBLND;
    const feeAdjustment = 1 / (1 - SWAP_FEE);
    
    return basePrice * feeAdjustment;
}

async function checkUpdates() {
    try {
        const currentLedger = await getLatestLedger();
        
        if (lastLedger !== currentLedger) {
            const blnd = await getBalance(BLND_TOKEN_CONTRACT);
            const aqua = await getBalance(AQUA_TOKEN_CONTRACT);
            
            const spotPrice = calculateSpotPrice(aqua, blnd);
            const formattedPrice = spotPrice.toFixed(7);
            
            let priceChange = null;
            if (lastPrice !== null) {
                priceChange = spotPrice - Number(lastPrice);
            }
            
            balanceMonitor.emit('update', {
                ledger: currentLedger,
                blnd: blnd,
                aqua: aqua,
                spotPrice: spotPrice,
                formattedPrice: formattedPrice,
                priceChange: priceChange
            });
            
            lastLedger = currentLedger;
            lastPrice = formattedPrice;
        }
    } catch (error) {
        console.error('Error in checkUpdates:', error);
    }
}

export function startMonitor() {
    console.log(`Starting BLND/AQUA spot price monitor...`);
    console.log(`Pool Weights: BLND=${BLND_WEIGHT}, AQUA=${AQUA_WEIGHT}`);
    console.log(`Swap Fee: ${SWAP_FEE * 100}%\n`);
    
    checkUpdates();
    const intervalId = setInterval(checkUpdates, 5000);
    return intervalId;
}

process.on('SIGINT', () => {
    console.log('\nStopping spot price monitor...');
    process.exit(0);
});